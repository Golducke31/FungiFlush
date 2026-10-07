package com.fungiflush.game

import android.app.Activity
import android.content.Context
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Puente a Google Play Games Services.
 *
 * Lo llama el Rust del contenedor por JNI (`src-tauri/src/play_games.rs`), que
 * a su vez es lo que el frontend ve como `google_play_available` /
 * `google_play_sign_in` / `google_play_sign_out` (ver `src/meta/Account.ts`).
 *
 * POR QUE ASI:
 *  - `signIn` BLOQUEA (`Tasks.await`) y por eso Rust lo llama desde un hilo de
 *    trabajo, NUNCA desde el hilo de UI: bloquear el hilo principal de Android
 *    congela la app entera. La promesa de Kotlin viaja como JSON y el contrato
 *    queda en un solo string, sin objetos JNI de ida y vuelta.
 *  - El resultado NUNCA es una excepcion cruzando JNI (eso es fragil): siempre
 *    es un JSON con `status` = ok | cancelled | error.
 *
 * El juego se puede jugar ENTERO offline: "no hay cuenta" es un estado normal
 * de la UI, no un fallo.
 */
object PlayGamesBridge {

    /** Cuanto se espera a que el jugador resuelva el dialogo de Google. */
    private const val SIGN_IN_TIMEOUT_S = 120L
    private const val PLAYER_TIMEOUT_S = 30L

    /** `PlayGamesSdk.initialize` es idempotente, pero se llama una sola vez. */
    @Volatile
    private var initialized = false

    /**
     * Prepara el SDK. Lo llama `MainActivity.onCreate` al arrancar; se repite
     * como red de seguridad por si el puente se usa antes.
     *
     * El `try` NO es decorativo: si el APP_ID de Play Games esta mal o falta,
     * `PlayGamesSdk.initialize` puede tirar. Eso NO puede tumbar el arranque del
     * juego — que se puede jugar entero offline es un invariante del diseno.
     */
    @JvmStatic
    fun initialize(context: Context) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            try {
                PlayGamesSdk.initialize(context.applicationContext)
                initialized = true
            } catch (e: Throwable) {
                // Se reintenta en el proximo `signIn` (que devuelve el error).
            }
        }
    }

    /** El contenedor trae el SDK de Play Games. */
    @JvmStatic
    fun available(): Boolean = true

    /**
     * Inicia sesion y devuelve la identidad como JSON.
     *
     * Devuelve:
     *   {"status":"ok","id":"...","displayName":"..."}
     *   {"status":"cancelled"}                    el jugador cerro el dialogo
     *   {"status":"error","message":"..."}        fallo real (sin Play Games,
     *                                             SHA-1 sin registrar, etc.)
     */
    @JvmStatic
    fun signIn(activity: Activity): String {
        return try {
            initialize(activity)
            val client = PlayGames.getGamesSignInClient(activity)
            val auth = Tasks.await(client.signIn(), SIGN_IN_TIMEOUT_S, TimeUnit.SECONDS)
            if (!auth.isAuthenticated) {
                // Sin autenticar y sin excepcion = el jugador dijo que no.
                return JSONObject().put("status", "cancelled").toString()
            }
            val player = Tasks.await(
                PlayGames.getPlayersClient(activity).currentPlayer,
                PLAYER_TIMEOUT_S,
                TimeUnit.SECONDS,
            )
            JSONObject()
                .put("status", "ok")
                .put("id", player.playerId)
                .put("displayName", player.displayName)
                .toString()
        } catch (e: Exception) {
            // El caso tipico es SIGN_IN_REQUIRED / DEVELOPER_ERROR: la huella
            // SHA-1 del keystore no esta registrada en Play Console. El mensaje
            // viaja para que se pueda diagnosticar sin un logcat.
            JSONObject()
                .put("status", "error")
                .put("message", e.message ?: e.javaClass.simpleName)
                .toString()
        }
    }

    /**
     * Cierra la sesion. NO borra NADA local: el progreso es del jugador, no de
     * la cuenta (desvincular nunca debe costarle la Colonia a nadie).
     */
    @JvmStatic
    fun signOut(activity: Activity): Boolean {
        return try {
            PlayGames.getGamesSignInClient(activity).signOut()
            true
        } catch (e: Exception) {
            false
        }
    }
}
