import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    // [Phase 5] 아래에서 조건부 apply하기 위해 먼저 선언만 한다(apply false).
    alias(libs.plugins.google.services) apply false
}

// [Phase 5] google-services.json은 Git에 commit하지 않는다(.gitignore 참조).
// Firebase Console에서 다운로드한 실제 파일을 app/google-services.json에 두면
// 이 플러그인이 적용되어 Firebase 초기화 값이 APK에 주입된다.
// 파일이 없어도 빌드는 성공한다(Firebase 기능 OFF, Graph fallback은 동작).
val hasGoogleServicesJson = file("google-services.json").exists()
if (hasGoogleServicesJson) {
    apply(plugin = "com.google.gms.google-services")
}

// MSAL 설정값은 Git에 commit하지 않는다. local.properties(gitignore됨)에서 읽는다.
val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val msalClientId = localProperties.getProperty("msal.clientId") ?: ""
val msalAuthority = localProperties.getProperty("msal.authority")
    ?: "https://login.microsoftonline.com/organizations"

android {
    namespace = "com.nomistake.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nomistake.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "MSAL_CLIENT_ID", "\"$msalClientId\"")
        buildConfigField("String", "MSAL_AUTHORITY", "\"$msalAuthority\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "META-INF/DEPENDENCIES"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    sourceSets {
        // Room migration 단위 테스트(MigrationTestHelper + Robolectric)가 schema JSON을
        // assets에서 읽는다(assetsFolder = DB 클래스 canonical name). Robolectric은
        // debug variant의 merged assets(intermediates/assets/debug)을 사용하므로
        // debug sourceSet에만 포함한다 → release APK에는 번들되지 않는다.
        // schema에는 민감정보가 없다(테이블 구조만).
        getByName("debug") {
            assets.srcDirs("$projectDir/schemas")
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.msal)
    implementation(libs.okhttp)
    implementation(libs.gson)

    // Firebase (Phase 5) - Auth(Email/Password) + Firestore read.
    // google-services.json이 있을 때만 런타임 초기화된다(빌드는 항상 성공).
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.kotlinx.coroutines.play.services) // Firebase Task.await()

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.room.testing) // Room migration 테스트
}
