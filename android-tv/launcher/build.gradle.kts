// The owner's TV home screen («TCL Home», package `local.tclhome`), rebuilt from the sideloaded
// original with a «Сеанс» tile added. Plain Android views, no Compose: it must be instant on a 1 GB TV.
// Signed with the local debug key, the same key as the original, so it installs over it in place
// and keeps its accessibility service and Home role.
plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "local.tclhome"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "local.tclhome"
        minSdk = 30
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
