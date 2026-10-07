package com.fungiflush.game

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Play Games Services: preparar el SDK ANTES de que el frontend pueda pedir
    // la identidad. Si el APP_ID no esta configurado, el puente lo traga y el
    // juego arranca igual (se puede jugar entero offline).
    PlayGamesBridge.initialize(this)
  }
}
