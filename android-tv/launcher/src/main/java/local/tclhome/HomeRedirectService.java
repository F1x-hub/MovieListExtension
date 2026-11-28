package local.tclhome;

import android.accessibilityservice.AccessibilityService;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;

/**
 * Brings TCL Home back whenever the Google TV launcher comes to the front: at boot, after the TV
 * wakes from sleep, and when Home opens the stock launcher. The accessibility config
 * ({@code res/xml/home_redirect.xml}) limits events to window changes of that launcher.
 */
public class HomeRedirectService extends AccessibilityService {
    private static final long BOOT_WINDOW_MS = 120_000L;
    private static final long WAKE_DELAY_MS = 1_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable showHome = this::openHomeWhenInteractive;
    private final BroadcastReceiver powerReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            handler.removeCallbacks(showHome);
            if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) {
                handler.postDelayed(showHome, WAKE_DELAY_MS);
            }
        }
    };
    private boolean observingPower;

    @Override
    protected void onServiceConnected() {
        if (!observingPower) {
            IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_ON);
            filter.addAction(Intent.ACTION_SCREEN_OFF);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(powerReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(powerReceiver, filter);
            }
            observingPower = true;
        }

        // Once per boot, shortly after it: the stock launcher may already be up before this
        // service connects, so no window event would arrive for it.
        int bootCount = Settings.Global.getInt(getContentResolver(), "boot_count", -1);
        SharedPreferences prefs = getSharedPreferences("startup", MODE_PRIVATE);
        if (bootCount >= 0 && bootCount != prefs.getInt("lastBoot", -1)) {
            prefs.edit().putInt("lastBoot", bootCount).apply();
            if (SystemClock.elapsedRealtime() < BOOT_WINDOW_MS) {
                handler.removeCallbacks(showHome);
                handler.postDelayed(showHome, WAKE_DELAY_MS);
            }
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && "com.google.android.apps.tv.launcherx".equals(String.valueOf(event.getPackageName()))
                && "com.google.android.apps.tv.launcherx.home.HomeActivity".equals(String.valueOf(event.getClassName()))) {
            handler.removeCallbacks(showHome);
            openHomeWhenInteractive();
        }
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(showHome);
        if (observingPower) {
            unregisterReceiver(powerReceiver);
            observingPower = false;
        }
        super.onDestroy();
    }

    private void openHomeWhenInteractive() {
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null && power.isInteractive()) {
            startActivity(new Intent(this, HomeActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION));
        }
    }
}
