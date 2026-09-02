package com.nomistake.app.data.remote

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.tasks.await

/**
 * Internal pilot Firebase Authentication wrapper.
 *
 * - Android never uses the PC service-account credential.
 * - Users do not manage Firebase email/password accounts.
 * - The app silently creates/restores an anonymous Firebase session.
 * - Personal checklist/settings data remains device-local; Firebase Auth only gates shared calendar reads.
 */
class FirebaseAuthManager(private val auth: FirebaseAuth) {

    val isSignedIn: Boolean
        get() = auth.currentUser != null

    val currentUid: String?
        get() = auth.currentUser?.uid

    /**
     * Reuse an existing anonymous session. Legacy non-anonymous pilot sessions are signed out once,
     * then replaced by an anonymous session so normal users never need credentials.
     *
     * @return true when a new anonymous session was created, false when an existing anonymous
     * session was already active.
     */
    suspend fun ensureAnonymousSignIn(): Boolean {
        val current = auth.currentUser
        if (current?.isAnonymous == true) return false

        if (current != null) {
            auth.signOut()
        }

        auth.signInAnonymously().await()
        check(auth.currentUser?.isAnonymous == true) {
            "Firebase anonymous authentication did not produce an anonymous user"
        }
        return true
    }

    /** Debug/maintenance compatibility only; normal pilot UI does not expose credentials. */
    suspend fun signIn(email: String, password: String) {
        val trimmedEmail = email.trim()
        require(trimmedEmail.isNotEmpty()) { "이메일을 입력하세요" }
        require(password.isNotEmpty()) { "비밀번호를 입력하세요" }
        auth.signInWithEmailAndPassword(trimmedEmail, password).await()
    }

    val currentEmail: String?
        get() = auth.currentUser?.email

    fun signOut() {
        auth.signOut()
    }
}
