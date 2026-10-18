package uz.atlas.app

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMethodCodec
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import kotlin.system.exitProcess

/**
 * Crashes that end the app before Dart can report them (docs/ai/monitoring.md,
 * "Client errors"). An uncaught Java/Kotlin exception is written to a file,
 * scrubbed, just before the app dies; native crashes and ANRs come from the
 * system's exit history (Android 11+). At the next start the Dart side
 * (lib/core/logging/android_crashes.dart) reads them over [CHANNEL], sends
 * them to our own server and acknowledges what the server took.
 */
object CrashRecords {
    private const val CHANNEL = "uz.atlas.app/crash_records"
    private const val DIR = "crash_records"
    private const val PREFS = "crash_records"
    // Exits up to this time (ms) were sent already.
    private const val LAST_EXIT = "last_exit"
    private const val EXIT_ID = "exit-"
    private const val MAX_RECORDS = 10
    private const val MAX_STACK_CHARS = 16_000
    // Holds the crashing thread of a tombstone and the main thread of an ANR trace.
    private const val MAX_TRACE_BYTES = 1024 * 1024
    private val JAVA_FILE = Regex("""java-\d+\.json""")

    // The rules of ErrorScrub (lib/core/logging/crash_reporter.dart, the same
    // patterns in the same order; a test compares them): no e-mail address,
    // Bearer value, JWT, URL query or long opaque value reaches the file.
    private val SCRUB = listOf(
        Regex("""Bearer\s+[A-Za-z0-9._~+/=-]+""", RegexOption.IGNORE_CASE) to "Bearer [REDACTED]",
        Regex("""eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}""") to "[REDACTED_JWT]",
        Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""") to "[REDACTED_EMAIL]",
        Regex("""(https?://[^\s?#"'<>]+)\?[^\s#"'<>]*""") to "\$1?[REDACTED]",
        Regex("""[A-Za-z0-9_+=-]{32,}""") to "[REDACTED]",
    )

    // As lib/app/build_info.dart: 0.1.0+1.
    private val appVersion = "${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"

    /** First thing at app start ([AtlasApplication]). */
    fun install(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Kept with this process's exit record: the version that crashed,
            // even when the next start is already an update.
            runCatching {
                context.getSystemService(ActivityManager::class.java).setProcessStateSummary(appVersion.toByteArray())
            }
        }
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { saveJavaCrash(context, error) }
            // The system's handler shows the crash and ends the process.
            if (previous != null) previous.uncaughtException(thread, error) else exitProcess(10)
        }
    }

    /** The channel the Dart side reads over ([MainActivity]). */
    fun attach(messenger: BinaryMessenger, context: Context) {
        // Files and the exit history are read off the main thread.
        val queue = messenger.makeBackgroundTaskQueue()
        MethodChannel(messenger, CHANNEL, StandardMethodCodec.INSTANCE, queue).setMethodCallHandler { call, result ->
            when (call.method) {
                "pending" -> result.success(javaCrashes(context) + exits(context))
                "acknowledge" -> {
                    acknowledge(context, call.arguments<List<String>>().orEmpty())
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun scrub(text: String) = SCRUB.fold(text) { s, (pattern, replacement) -> pattern.replace(s, replacement) }

    private fun saveJavaCrash(context: Context, error: Throwable) {
        val dir = File(context.filesDir, DIR).apply { mkdirs() }
        val time = System.currentTimeMillis()
        val record = JSONObject()
            .put("time", time)
            .put("version", appVersion)
            .put("trace", scrub(error.stackTraceToString()).take(MAX_STACK_CHARS))
        // Whole or not at all: only finished .json files are read.
        val tmp = File(dir, "java-$time.tmp")
        tmp.writeText(record.toString())
        tmp.renameTo(File(dir, "java-$time.json"))
    }

    private fun javaCrashes(context: Context): List<Map<String, Any?>> {
        val files = File(context.filesDir, DIR).listFiles().orEmpty()
        files.filter { it.name.endsWith(".tmp") }.forEach { it.delete() }
        return files.filter { JAVA_FILE.matches(it.name) }.sortedBy { it.name }.take(MAX_RECORDS).mapNotNull { file ->
            try {
                val record = JSONObject(file.readText())
                mapOf(
                    "id" to file.name,
                    "kind" to "java",
                    "time" to record.getLong("time"),
                    "version" to record.getString("version"),
                    "trace" to record.getString("trace"),
                )
            } catch (e: Exception) {
                file.delete() // unreadable: nothing to send
                null
            }
        }
    }

    // Native crashes and ANRs that ended the app since the last acknowledged
    // one, oldest first. A Java crash is in the history too (REASON_CRASH),
    // without its exception: the file above has it.
    private fun exits(context: Context): List<Map<String, Any?>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
        val after = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(LAST_EXIT, 0)
        val history = runCatching {
            context.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(context.packageName, 0, 0)
        }.getOrDefault(emptyList())
        return history
            .filter { it.timestamp > after }
            .filter { it.reason == ApplicationExitInfo.REASON_CRASH_NATIVE || it.reason == ApplicationExitInfo.REASON_ANR }
            .sortedBy { it.timestamp }
            .take(MAX_RECORDS)
            .map { exit ->
                val anr = exit.reason == ApplicationExitInfo.REASON_ANR
                // An ANR trace, or a tombstone from Android 12 on (before it, a
                // native crash's stream can only be an earlier ANR's trace).
                // Read only in memory.
                val trace = if (anr || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    runCatching { exit.traceInputStream?.use { readAtMost(it, MAX_TRACE_BYTES) } }.getOrNull()
                } else {
                    null
                }
                mapOf(
                    "id" to "$EXIT_ID${exit.timestamp}",
                    "kind" to if (anr) "anr" else "native",
                    "time" to exit.timestamp,
                    "version" to (exit.processStateSummary?.toString(Charsets.UTF_8) ?: appVersion),
                    "description" to exit.description,
                    "status" to exit.status,
                    "trace" to trace,
                )
            }
    }

    private fun acknowledge(context: Context, ids: List<String>) {
        val dir = File(context.filesDir, DIR)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var lastExit = prefs.getLong(LAST_EXIT, 0)
        for (id in ids) {
            when {
                JAVA_FILE.matches(id) -> File(dir, id).delete()
                id.startsWith(EXIT_ID) -> id.removePrefix(EXIT_ID).toLongOrNull()?.let { lastExit = maxOf(lastExit, it) }
            }
        }
        prefs.edit().putLong(LAST_EXIT, lastExit).apply()
    }

    private fun readAtMost(input: InputStream, max: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        while (out.size() < max) {
            val n = input.read(buffer, 0, minOf(buffer.size, max - out.size()))
            if (n < 0) break
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }
}
