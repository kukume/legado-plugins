plugins {
    id("java")
    alias(libs.plugins.kotlin)
    alias(libs.plugins.intellij)
    alias(libs.plugins.kotlin.lombok)
    alias(libs.plugins.lombok)
}

group = "me.kuku"
version = "1.0.0"

repositories {
    mavenCentral()

    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    // 不打包第三方带进来的 kotlin-stdlib/reflect，统一用 IDE 平台自带版本
    implementation(libs.okhttp) {
        exclude(group = "org.jetbrains.kotlin")
    }
    implementation(libs.jackson.databind)
    implementation(libs.jackson.kotlin) {
        exclude(group = "org.jetbrains.kotlin")
    }
    implementation(libs.guava)

    // Configure Gradle IntelliJ Plugin
    // Read more: https://plugins.jetbrains.com/docs/intellij/tools-gradle-intellij-plugin.html
    intellijPlatform {
        intellijIdea("2025.2.5")

        bundledPlugin("com.intellij.java")
    }
}

tasks {
    // Set the JVM compatibility versions
    withType<JavaCompile> {
        sourceCompatibility = "21"
        targetCompatibility = "21"
    }

    patchPluginXml {
        sinceBuild.set("252")
    }

    named<org.gradle.api.tasks.bundling.Zip>("buildPlugin") {
        archiveBaseName.set("legado-kuku")
    }

    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }
}
