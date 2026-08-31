package com.nomistake.app.data.remote

import android.app.Activity
import android.content.Context
import com.microsoft.identity.client.AcquireTokenParameters
import com.microsoft.identity.client.AcquireTokenSilentParameters
import com.microsoft.identity.client.AuthenticationCallback
import com.microsoft.identity.client.IAuthenticationResult
import com.microsoft.identity.client.IMultipleAccountPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SilentAuthenticationCallback
import com.microsoft.identity.client.exception.MsalException
import com.nomistake.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * MSAL 기반 Microsoft 로그인 래퍼.
 *
 * - client ID는 BuildConfig(→ local.properties)에서 읽는다. Git에 commit하지 않는다.
 * - redirect URI는 debug keystore의 signature hash 기반 고정값.
 * - Graph 읽기 전용이므로 Calendars.Read delegated permission만 사용한다.
 */
class MsalAuthManager(context: Context) {

    companion object {
        const val GRAPH_SCOPE_CALENDARS_READ = "https://graph.microsoft.com/Calendars.Read"

        // debug keystore signature hash (SHA-256, base64). release 빌드 시 별도 등록 필요.
        // AndroidManifest.xml에는 raw(비인코딩) 값을 사용한다.
        const val REDIRECT_URI =
            "msauth://com.nomistake.app/UkDjR7Xa66v+1nGvkiST7mCH+N3MtWtdpJ5axfCEM/Y="

        // auth_config.json에는 URL 인코딩된 redirect_uri를 사용한다.
        const val REDIRECT_URI_ENCODED =
            "msauth://com.nomistake.app/UkDjR7Xa66v%2B1nGvkiST7mCH%2BN3MtWtdpJ5axfCEM%2FY%3D"
    }

    private val appContext = context.applicationContext

    @Volatile
    private var app: IMultipleAccountPublicClientApplication? = null

    private suspend fun getApp(): IMultipleAccountPublicClientApplication {
        app?.let { return it }
        return withContext(Dispatchers.IO) {
            app ?: createApp().also { app = it }
        }
    }

    private fun createApp(): IMultipleAccountPublicClientApplication {
        val configJson = """
            {
              "client_id": "${BuildConfig.MSAL_CLIENT_ID}",
              "redirect_uri": "$REDIRECT_URI_ENCODED",
              "authorities": [
                {
                  "type": "AAD",
                  "authority_url": "${BuildConfig.MSAL_AUTHORITY}"
                }
              ]
            }
        """.trimIndent()

        val configFile = File(appContext.cacheDir, "msal_config.json")
        configFile.writeText(configJson)

        return PublicClientApplication.createMultipleAccountPublicClientApplication(
            appContext,
            configFile
        )
    }

    /** 대화형 로그인 후 access token 반환 */
    suspend fun acquireToken(activity: Activity, scopes: List<String>): String {
        val application = getApp()
        return suspendCancellableCoroutine { cont ->
            val parameters = AcquireTokenParameters.Builder()
                .startAuthorizationFromActivity(activity)
                .withScopes(scopes)
                .withCallback(object : AuthenticationCallback {
                    override fun onSuccess(result: IAuthenticationResult) {
                        cont.resume(result.accessToken)
                    }

                    override fun onError(exception: MsalException) {
                        cont.resumeWithException(exception)
                    }

                    override fun onCancel() {
                        cont.cancel()
                    }
                })
                .build()
            application.acquireToken(parameters)
        }
    }

    /** 캐시된 계정으로 silent token 획득. 계정이 없으면 null. */
    suspend fun acquireTokenSilent(scopes: List<String>): String? {
        val application = getApp()
        val account = application.accounts.firstOrNull() ?: return null
        return suspendCancellableCoroutine { cont ->
            val parameters = AcquireTokenSilentParameters.Builder()
                .withScopes(scopes)
                .forAccount(account)
                .withCallback(object : SilentAuthenticationCallback {
                    override fun onSuccess(result: IAuthenticationResult) {
                        cont.resume(result.accessToken)
                    }

                    override fun onError(exception: MsalException) {
                        cont.resumeWithException(exception)
                    }
                })
                .build()
            application.acquireTokenSilent(parameters)
        }
    }
}
