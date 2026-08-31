plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.google.services) apply false
}

// Dropbox 동기화가 build 디렉터리를 잠그는 문제를 피하기 위해
// 빌드 산출물을 Dropbox 밖으로 이동한다. (projectcachedir과 동일한 이유)
allprojects {
    layout.buildDirectory.set(file("C:/Users/parkj/AppData/Local/nomistake-build/${project.name}"))
}
