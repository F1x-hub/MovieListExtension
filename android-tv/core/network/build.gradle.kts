// One OkHttp client for the app, resolving names over DNS-over-HTTPS. Owned by the `tv-sources` session.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "app.seans.tv.network"
    compileSdk = libs.versions.compileSdk.get().toInt()
    defaultConfig { minSdk = libs.versions.minSdk.get().toInt() }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    api(libs.okhttp)
    implementation(libs.okhttp.dnsoverhttps)
    api(libs.kotlinx.coroutines.android)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
}
