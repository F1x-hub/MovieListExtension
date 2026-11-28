import org.gradle.api.initialization.resolve.RepositoriesMode

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SeansTv"

include(":app")
include(":core:model")
include(":core:designsystem")
include(":core:network")
include(":data")
include(":sources")
include(":player")
include(":live")
include(":launcher")
