plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}
android {
    namespace = "org.kairos.android"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig {
        applicationId = "org.kairos.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "0.2.3"
    }
    signingConfigs.getByName("debug") {
        providers.environmentVariable("KAIROS_DEBUG_KEYSTORE").orNull?.let { path ->
            storeFile = file(path)
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    val releaseKeystore = providers.environmentVariable("KAIROS_RELEASE_KEYSTORE").orNull
    if (releaseKeystore != null) {
        signingConfigs.create("release") {
            storeFile = file(releaseKeystore)
            storePassword = providers.environmentVariable("KAIROS_RELEASE_STORE_PASSWORD").get()
            keyAlias = providers.environmentVariable("KAIROS_RELEASE_KEY_ALIAS").get()
            keyPassword = providers.environmentVariable("KAIROS_RELEASE_KEY_PASSWORD").get()
        }
        buildTypes.getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(libs.okhttp)
    implementation(libs.serialization.json)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui)
    implementation(libs.activity.compose)
    implementation(libs.webkit)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.savedstate)
    implementation(libs.navigation.compose)
    implementation(libs.commonmark)
    implementation(libs.commonmark.tables)
    implementation(libs.commonmark.strikethrough)
    implementation(libs.commonmark.tasklist)
    implementation(libs.commonmark.autolink)
    implementation(libs.jlatexmath)
    implementation(libs.highlights)
    testImplementation(libs.junit)
}

val generateTranscript by tasks.registering(Exec::class) {
    description = "Build the shared offline transcript required by the Android APK"
    group = "build"
    workingDir = rootProject.projectDir.parentFile
    val pnpm = if (System.getProperty("os.name").startsWith("Windows")) "pnpm.cmd" else "pnpm"
    commandLine(pnpm, "build:transcript")
    // Rebuild whenever shared renderer code changes, rather than packaging stale assets.
    inputs.files(fileTree(rootProject.projectDir.parentFile.resolve("src")))
    inputs.files(
        rootProject.projectDir.parentFile.resolve("transcript.html"),
        rootProject.projectDir.parentFile.resolve("vite.transcript.config.ts"),
        rootProject.projectDir.parentFile.resolve("package.json"),
        rootProject.projectDir.parentFile.resolve("pnpm-lock.yaml"),
        rootProject.projectDir.parentFile.resolve("scripts/gen-android-theme.mjs"),
        rootProject.projectDir.parentFile.resolve("scripts/gen-android-icons.mjs"),
    )
    outputs.dir(layout.projectDirectory.dir("src/main/assets/transcript"))
}

tasks.named("preBuild") {
    dependsOn(generateTranscript)
}
