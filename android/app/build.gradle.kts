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
        versionCode = 1
        versionName = "0.2-demo"
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
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.savedstate)
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
    // The generated transcript imports web components, icons and styles. Always run
    // the generator before an APK build rather than packaging a stale local asset.
    outputs.dir(layout.projectDirectory.dir("src/main/assets/transcript"))
}

tasks.named("preBuild") {
    dependsOn(generateTranscript)
}
