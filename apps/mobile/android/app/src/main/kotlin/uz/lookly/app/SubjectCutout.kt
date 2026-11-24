package uz.lookly.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMethodCodec
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Background removal for wardrobe photos, on the phone (ML Kit subject
 * segmentation). The garment is cut out, placed on a plain light background
 * and cropped to it with a margin. Any failure — no model yet, no subject,
 * a timeout — answers null, and the Dart side keeps the original photo.
 */
object SubjectCutout {
    private const val CHANNEL = "uz.lookly.app/subject_cutout"
    // Segmentation input: large enough for a sharp result, small enough for memory.
    private const val MAX_SIDE = 2048
    private const val MIN_SIDE = 256 // the server's minimum shortest side
    private const val MIN_COVERAGE = 0.02 // less than 2 % of the photo: no garment found
    private const val MARGIN = 0.08
    private const val TIMEOUT_SECONDS = 20L
    private val BACKGROUND = Color.rgb(0xF7, 0xF5, 0xF1)

    /** The channel the Dart side calls ([MainActivity]). */
    fun attach(messenger: BinaryMessenger) {
        // Off the main thread: decoding and segmentation take a moment.
        val queue = messenger.makeBackgroundTaskQueue()
        MethodChannel(messenger, CHANNEL, StandardMethodCodec.INSTANCE, queue).setMethodCallHandler { call, result ->
            when (call.method) {
                "cutout" -> result.success(runCatching { cutout(call.arguments as ByteArray) }.getOrNull())
                else -> result.notImplemented()
            }
        }
    }

    private fun cutout(bytes: ByteArray): ByteArray? {
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        val scale = MAX_SIDE.toFloat() / max(decoded.width, decoded.height)
        val source = if (scale < 1f) {
            Bitmap.createScaledBitmap(decoded, (decoded.width * scale).roundToInt(), (decoded.height * scale).roundToInt(), true)
        } else {
            decoded
        }
        val segmenter = SubjectSegmentation.getClient(
            SubjectSegmenterOptions.Builder().enableForegroundBitmap().build(),
        )
        try {
            val result = Tasks.await(segmenter.process(InputImage.fromBitmap(source, 0)), TIMEOUT_SECONDS, TimeUnit.SECONDS)
            val foreground = result.foregroundBitmap ?: return null
            return compose(foreground)
        } finally {
            segmenter.close()
        }
    }

    /** The cut-out garment on [BACKGROUND], cropped to its bounds plus [MARGIN]; null when too little is left. */
    private fun compose(foreground: Bitmap): ByteArray? {
        val w = foreground.width
        val h = foreground.height
        val pixels = IntArray(w * h)
        foreground.getPixels(pixels, 0, w, 0, 0, w, h)
        var left = w
        var top = h
        var right = -1
        var bottom = -1
        var opaque = 0
        for (y in 0 until h) {
            for (x in 0 until w) {
                if (Color.alpha(pixels[y * w + x]) > 24) {
                    opaque++
                    if (x < left) left = x
                    if (x > right) right = x
                    if (y < top) top = y
                    if (y > bottom) bottom = y
                }
            }
        }
        if (right < 0 || opaque < w * h * MIN_COVERAGE) return null
        val margin = (max(right - left, bottom - top) * MARGIN).roundToInt()
        val cropLeft = (left - margin).coerceAtLeast(0)
        val cropTop = (top - margin).coerceAtLeast(0)
        val cropWidth = (right + margin).coerceAtMost(w - 1) - cropLeft + 1
        val cropHeight = (bottom + margin).coerceAtMost(h - 1) - cropTop + 1
        if (minOf(cropWidth, cropHeight) < MIN_SIDE) return null
        val out = Bitmap.createBitmap(cropWidth, cropHeight, Bitmap.Config.ARGB_8888)
        Canvas(out).apply {
            drawColor(BACKGROUND)
            drawBitmap(foreground, -cropLeft.toFloat(), -cropTop.toFloat(), null)
        }
        return ByteArrayOutputStream().use { stream ->
            out.compress(Bitmap.CompressFormat.JPEG, 92, stream)
            stream.toByteArray()
        }
    }
}
