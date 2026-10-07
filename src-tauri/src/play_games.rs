//! play_games.rs — Puente a Google Play Games Services.
//!
//! CONTRATO: la UI nunca habla con Android directamente. Llama a estos tres
//! comandos por `invoke()` (ver `src/meta/Account.ts`, que es el unico lugar
//! que los nombra):
//!
//!   google_play_available  -> bool
//!   google_play_sign_in    -> { id, displayName }
//!   google_play_sign_out   -> ()
//!
//! ARQUITECTURA (por que JNI y no un plugin de Tauri):
//!   TS  (src/meta/Account.ts)
//!    └─ invoke()  ->  Rust (este archivo)
//!                      └─ JNI  ->  Kotlin (PlayGamesBridge.kt, en el proyecto
//!                                  Android generado por `tauri android init`)
//!
//! El plugin de Play Games necesita una `Activity` y devuelve promesas; las dos
//! cosas viven mejor del lado Android. Rust solo traduce: pide, recibe un JSON y
//! lo convierte en el tipo que espera el frontend. Un plugin de Tauri agregaria
//! un crate entero para tres funciones de una sola app.
//!
//! HILOS: `sign_in` BLOQUEA (Play Games muestra su propio dialogo) y por eso se
//! corre en `spawn_blocking`, nunca en el hilo de UI ni en un worker async.
//! Bloquear el hilo principal de Android congela la app entera.
//!
//! OFFLINE-FIRST: el juego se puede jugar ENTERO sin cuenta. "No hay cuenta" es
//! un estado normal de la UI, no un fallo. En escritorio (o en el navegador)
//! `available()` devuelve `false` y `sign_in` devuelve un error explicito.

use serde::Serialize;

/// Identidad que devuelve Play Games. Los nombres van en camelCase porque los
/// consume TypeScript (`AccountIdentity` en `src/meta/Account.ts`).
#[derive(Debug, Serialize)]
pub struct PlayGamesIdentity {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
}

/// El contenedor puede iniciar sesion con Play Games?
#[tauri::command]
pub fn google_play_available() -> bool {
    imp::available()
}

/// Abre el flujo de inicio de sesion. Devuelve la identidad, o un error.
#[tauri::command]
pub async fn google_play_sign_in() -> Result<PlayGamesIdentity, String> {
    // `spawn_blocking`: el dialogo de Google puede tardar lo que tarde el
    // jugador, y ese bloqueo no puede comerse un worker del runtime async.
    tauri::async_runtime::spawn_blocking(imp::sign_in)
        .await
        .map_err(|e| format!("la tarea de inicio de sesion fallo: {e}"))?
}

/// Cierra la sesion. No borra NADA local: el progreso es del jugador, no de la
/// cuenta (desvincular nunca debe costarle la Colonia a nadie).
#[tauri::command]
pub async fn google_play_sign_out() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(imp::sign_out)
        .await
        .map_err(|e| format!("la tarea de cierre de sesion fallo: {e}"))?
}

// ---------------------------------------------------------------------------
// Implementacion Android (JNI)
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
mod android {
    use super::PlayGamesIdentity;
    use jni::objects::{JObject, JString, JValue};
    use jni::JavaVM;
    use serde::Deserialize;

    /// Clase Kotlin del puente. Ver
    /// `src-tauri/gen/android/app/src/main/java/com/fungiflush/game/PlayGamesBridge.kt`.
    const BRIDGE_CLASS: &str = "com/fungiflush/game/PlayGamesBridge";

    /// Respuesta del puente. El `status` distingue "el jugador dijo que no"
    /// (`cancelled`) de un fallo real (`error`), que es informacion que la UI
    /// necesita para no mentir.
    #[derive(Deserialize)]
    struct RawResponse {
        status: String,
        #[serde(default)]
        id: Option<String>,
        #[serde(default, rename = "displayName")]
        display_name: Option<String>,
        #[serde(default)]
        message: Option<String>,
    }

    /// Adjunta el hilo actual a la JVM y pasa el `JNIEnv` + la `Activity`.
    ///
    /// La `Activity` la publica el contenedor: Tauri inicializa `ndk-context`
    /// con el contexto de Android al arrancar, asi que no hay que pasarla a
    /// mano ni guardarla en un `static`.
    fn with_activity<T>(
        f: impl FnOnce(&mut jni::JNIEnv, &JObject) -> Result<T, String>,
    ) -> Result<T, String> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("no se pudo obtener la JVM: {e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("no se pudo adjuntar el hilo a la JVM: {e}"))?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
        f(&mut env, &activity)
    }

    pub fn available() -> bool {
        with_activity(|env, _| {
            let class = env
                .find_class(BRIDGE_CLASS)
                .map_err(|e| format!("clase del puente no encontrada: {e}"))?;
            let value = env
                .call_static_method(class, "available", "()Z", &[])
                .map_err(|e| format!("available() fallo: {e}"))?;
            value.z().map_err(|e| format!("available() no devolvio un bool: {e}"))
        })
        // Un fallo aca significa "no hay Play Games en este dispositivo": para la
        // UI eso es "no disponible", nunca un error fatal.
        .unwrap_or(false)
    }

    pub fn sign_in() -> Result<PlayGamesIdentity, String> {
        let json = with_activity(|env, activity| {
            let class = env
                .find_class(BRIDGE_CLASS)
                .map_err(|e| format!("clase del puente no encontrada: {e}"))?;
            let value = env
                .call_static_method(
                    class,
                    "signIn",
                    "(Landroid/app/Activity;)Ljava/lang/String;",
                    &[JValue::Object(activity)],
                )
                .map_err(|e| format!("signIn() fallo: {e}"))?;
            let obj = value.l().map_err(|e| format!("signIn() no devolvio un objeto: {e}"))?;
            if obj.is_null() {
                return Ok(String::new());
            }
            let text: JString = obj.into();
            let owned = env
                .get_string(&text)
                .map_err(|e| format!("no se pudo leer el texto del puente: {e}"))?;
            Ok(String::from(owned))
        })?;

        if json.is_empty() {
            return Err("El inicio de sesion se cancelo".to_string());
        }

        let raw: RawResponse =
            serde_json::from_str(&json).map_err(|e| format!("respuesta ilegible del puente: {e}"))?;

        match raw.status.as_str() {
            "ok" => {
                let id = raw.id.unwrap_or_default();
                if id.is_empty() {
                    return Err("Play Games no devolvio un identificador".to_string());
                }
                Ok(PlayGamesIdentity {
                    id,
                    display_name: raw.display_name.unwrap_or_default(),
                })
            }
            "cancelled" => Err("El inicio de sesion se cancelo".to_string()),
            _ => Err(raw
                .message
                .unwrap_or_else(|| "Play Games no pudo iniciar sesion".to_string())),
        }
    }

    pub fn sign_out() -> Result<(), String> {
        with_activity(|env, activity| {
            let class = env
                .find_class(BRIDGE_CLASS)
                .map_err(|e| format!("clase del puente no encontrada: {e}"))?;
            env.call_static_method(
                class,
                "signOut",
                "(Landroid/app/Activity;)Z",
                &[JValue::Object(activity)],
            )
            .map_err(|e| format!("signOut() fallo: {e}"))?;
            Ok(())
        })
    }
}

// ---------------------------------------------------------------------------
// Implementacion de escritorio (sin Play Games)
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
mod desktop {
    use super::PlayGamesIdentity;

    /// En escritorio no hay Play Games. Devolver `false` (y no un error) es
    /// deliberado: la UI muestra "no disponible en este dispositivo" en vez de
    /// ofrecer un boton que va a fallar.
    pub fn available() -> bool {
        false
    }

    pub fn sign_in() -> Result<PlayGamesIdentity, String> {
        Err("Google Play Games solo esta disponible en Android".to_string())
    }

    pub fn sign_out() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(target_os = "android")]
use android as imp;
#[cfg(not(target_os = "android"))]
use desktop as imp;
