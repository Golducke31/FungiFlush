//! FungiFlush — punto de entrada del contenedor Tauri.
//!
//! El contenedor es deliberadamente delgado: NO contiene logica de juego.
//! Solo abre una ventana, carga el build de Vite y expone dos plugins:
//!
//!   - fs:    guardar/cargar la partida en el disco del usuario.
//!   - store: preferencias (idioma, volumen) en un JSON gestionado.
//!
//! Todo lo que el juego necesita saber del sistema operativo pasa por aca.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
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
