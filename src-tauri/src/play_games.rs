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
//! ESTADO: los tres son STUBS deliberados. El lado Android todavia no esta
//! cableado (falta inicializar Tauri Android, el SDK de Play Games y las
//! credenciales del proyecto en Play Console). Ver
//! `docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md`, que tiene los pasos exactos.
//!
//! Por que existen igual: asi el contrato queda escrito y compilando, y el dia
//! que se cablee el plugin solo se reemplaza el CUERPO de estas funciones. El
//! frontend no cambia una linea.
//!
//! `google_play_available` devuelve `false` (y no un error) cuando no esta
//! cableado a proposito: el juego se puede jugar ENTERO offline, asi que "no
//! hay cuenta" es un estado normal de la UI, no un fallo.

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
    // TODO(android): devolver `true` cuando `GoogleSignInClient` este cableado
    // y el proyecto de Play Games Services este configurado.
    false
}

/// Abre el flujo de inicio de sesion. Devuelve la identidad, o un error.
#[tauri::command]
pub fn google_play_sign_in() -> Result<PlayGamesIdentity, String> {
    Err("Google Play Games no esta integrado todavia (ver docs/PLAN_COLONIA_Y_GOOGLE_PLAY.md)".into())
}

/// Cierra la sesion. No borra NADA local: el progreso es del jugador, no de la
/// cuenta (desvincular nunca debe costarle la Colonia a nadie).
#[tauri::command]
pub fn google_play_sign_out() -> Result<(), String> {
    Ok(())
}
