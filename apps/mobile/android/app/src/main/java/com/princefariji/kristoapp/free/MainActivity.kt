package com.princefariji.kristoapp.free
import expo.modules.splashscreen.SplashScreenManager

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.Window
import androidx.core.view.WindowCompat

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import com.facebook.react.views.modal.ReactModalHostView
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    applyKristoNavigationBar()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      applyKristoNavigationBar()
    } else {
      // A React Native <Modal> opened: it has its own dialog window, which RN sets up edge-to-edge
      // with a white contrast scrim. Give it the same navy bar once RN is done with it.
      val decor = window.decorView
      decor.post { applyKristoNavigationBarToModals(decor) }
      decor.postDelayed({ applyKristoNavigationBarToModals(decor) }, 150)
    }
  }

  /**
   * Bottom system bar (Back / Home / Recents) in Kristo colours. React Native's edge-to-edge setup
   * makes it transparent with a white contrast scrim and dark buttons in light mode; Kristo is a
   * dark app, so: no scrim, navy behind the buttons, light buttons.
   */
  private fun applyKristoNavigationBar() {
    applyKristoNavigationBarTo(window)
  }

  private fun applyKristoNavigationBarTo(target: Window) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      target.isNavigationBarContrastEnforced = false
    }
    @Suppress("DEPRECATION")
    target.navigationBarColor = Color.parseColor("#0B0F17")
    WindowCompat.getInsetsController(target, target.decorView).isAppearanceLightNavigationBars = false
  }

  /** Modal host views stay in the activity's view tree; their dialogs hold the modal windows. */
  private fun applyKristoNavigationBarToModals(view: View) {
    if (view is ReactModalHostView) {
      val dialog = view.dialog
      val dialogWindow = dialog?.window
      if (dialog != null && dialog.isShowing && dialogWindow != null) {
        applyKristoNavigationBarTo(dialogWindow)
      }
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) applyKristoNavigationBarToModals(view.getChildAt(i))
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
