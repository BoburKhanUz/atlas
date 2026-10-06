import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "uz.atlas.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "uz.atlas.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Store signing: android/key.properties (never committed, git-ignored)
    // with storeFile, storePassword, keyAlias and keyPassword. A release
    // build WITHOUT it fails — see the signing guard below. The only escape
    // hatch is an explicit command-line `-PallowDebugSigning=true` (with
    // `flutter build`: `-PallowDebugSigning=true` / `--android-project-arg`),
    // which signs with the debug key for local testing only. Such builds must
    // never be distributed.
    val keystoreProperties = Properties().apply {
        val file = rootProject.file("key.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }
    val hasReleaseKey = keystoreProperties.getProperty("storeFile") != null

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Debug key only reaches here with -PallowDebugSigning=true; the
            // guard below fails every other release build without a key.
            signingConfig = signingConfigs.getByName(if (hasReleaseKey) "release" else "debug")
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

// Release signing guard (fails closed). Read only from the command line's
// -P properties: gradle.properties, ~/.gradle and ORG_GRADLE_PROJECT_*
// environment variables can NOT enable the debug-key fallback, so it cannot
// be switched on by accident or left on in a shared config.
val allowDebugSigning = gradle.startParameter.projectProperties["allowDebugSigning"] == "true"

gradle.taskGraph.whenReady {
    val releaseTaskRequested = allTasks.any { task ->
        task.project == project &&
            task.name.endsWith("Release") &&
            listOf("assemble", "bundle", "package", "sign").any { task.name.startsWith(it) }
    }
    if (!releaseTaskRequested) return@whenReady

    val keyProps = Properties().apply {
        val file = rootProject.file("key.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }
    if (keyProps.isEmpty) {
        if (!allowDebugSigning) {
            throw GradleException(
                "Release signing is not configured: android/key.properties is missing. " +
                    "Create it (see apps/mobile/config/README.md, 'Android release signing'). " +
                    "For a LOCAL, NON-DISTRIBUTABLE test build only, pass -PallowDebugSigning=true on the command line."
            )
        }
        // quiet: shown even with -q, which `flutter build` uses.
        logger.quiet("WARNING: release build signed with the DEBUG key (-PallowDebugSigning=true). Do NOT distribute it.")
        return@whenReady
    }
    val missing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword").filter { keyProps.getProperty(it).isNullOrBlank() }
    if (missing.isNotEmpty()) {
        throw GradleException("android/key.properties is incomplete; missing: ${missing.joinToString()}")
    }
    val storeFile = project.file(keyProps.getProperty("storeFile"))
    if (!storeFile.isFile) {
        throw GradleException("android/key.properties storeFile does not exist: ${keyProps.getProperty("storeFile")}")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
