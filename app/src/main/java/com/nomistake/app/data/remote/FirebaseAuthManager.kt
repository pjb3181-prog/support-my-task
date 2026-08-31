package com.nomistake.app.data.remote

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.tasks.await

/**
 * Firebase Authentication(Email/Password) 래퍼 (Phase 5).
 *
 * - Android에서 서비스 계정을 절대 사용하지 않는다(PC Companion만 서비스 계정 write 담당).
 * - 이메일/비밀번호는 앱 UI에서만 입력받는다(코드/리포지토리에 저장하지 않음).
 * - Firebase Auth가 로그인 세션을 유지하므로 앱 재시작 시 [isSignedIn]==true면
 *   로그인 화면을 생략할 수 있다.
 * - 회원가입 UI는 없다. 사용자는 Firebase Console(Authentication > Users)에서 직접 생성한다.
 */
class FirebaseAuthManager(private val auth: FirebaseAuth) {

    val currentEmail: String?
        get() = auth.currentUser?.email

    val isSignedIn: Boolean
        get() = auth.currentUser != null

    /** Email/Password 로그인. 실패 시 예외 발생(FirebaseAuthInvalidUserException 등). */
    suspend fun signIn(email: String, password: String) {
        val trimmedEmail = email.trim()
        require(trimmedEmail.isNotEmpty()) { "이메일을 입력하세요" }
        require(password.isNotEmpty()) { "비밀번호를 입력하세요" }
        auth.signInWithEmailAndPassword(trimmedEmail, password).await()
    }

    fun signOut() {
        auth.signOut()
    }
}