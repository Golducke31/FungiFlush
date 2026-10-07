//! FungiFlush — punto de entrada del contenedor Tauri.
//!
//! El contenedor es deliberadamente delgado: NO contiene logica de juego.
//! Solo abre una ventana, carga el build de Vite y expone tres plugins:
//!
//!   - fs:    guardar/cargar la partida en el disco del usuario.
//!   - store: preferencias (idioma, volumen) en un JSON gestionado.
//!   - play_games: identidad de Google Play Games (stubs, ver el modulo).
//!
//! Todo lo que el juego necesita saber del sistema operativo pasa por aca.

mod play_games;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            play_games::google_play_available,
            play_games::google_play_sign_in,
            play_games::google_play_sign_out
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                println!("[FungiFlush] contenedor Tauri listo (build de desarrollo)");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar FungiFlush");
}
