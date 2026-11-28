package local.tclhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.content.res.ColorStateList;
import android.media.tv.TvContract;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The owner's home screen. The whole screen is laid out in code on a fixed 1672x940 design grid,
 * scaled to the window (1280x720 on the TV), so nothing depends on density or resources.
 */
public class HomeActivity extends Activity {
    private static final int BACKGROUND = 0xFF090909;
    private static final int CARD = 0xFF181818;
    private static final int WHITE = 0xFFF7F7F7;
    private static final int MUTED = 0xFFBDBDBD;
    private static final int OUTLINE = 0xFF484848;

    private static final String HDMI_INPUT = "com.mediatek.tvinput/.hdmi.HDMIInputService/HW";
    private static final String STOCK_MEDIA_PACKAGE = "com.mediatek.wwtv.mediaplayer";
    private static final String VLC_PACKAGE = "org.videolan.vlc";

    private static final int DESIGN_WIDTH = 1672;
    private static final int DESIGN_HEIGHT = 940;

    // The app row keeps the original's side margins (x 67..1601) and its 14-unit gap; with seven
    // tiles each tile is 207 wide instead of 244.
    private static final int ROW_LEFT = 67;
    private static final int TILE_WIDTH = 207;
    private static final int TILE_STEP = 221;
    private static final int TILE_TOP = 278;
    private static final int TILE_HEIGHT = 287;
    private static final int LABEL_INSET = 6;
    private static final int LABEL_SIZE = 36;

    private static final App[] PINNED = {
            new App("Сеанс", "app.seans.tv", TileIcon.Glyph.SEANS),
            new App("SmartTube", "org.smarttube.stable", TileIcon.Glyph.SMART_TUBE),
            new App("Lampa", "top.rootu.lampa", TileIcon.Glyph.LAMPA),
            new App("YouTube", "com.google.android.youtube.tv", TileIcon.Glyph.YOUTUBE),
            new App("Play Маркет", "com.android.vending", TileIcon.Glyph.STORE),
            new App("Медиаплеер", VLC_PACKAGE, TileIcon.Glyph.MEDIA),
            new App("ТВ", "com.mediatek.wwtv.tvcenter", TileIcon.Glyph.TV),
    };

    private record App(String label, String packageName, TileIcon.Glyph glyph) {
    }

    private FrameLayout screen;
    private float scale;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        screen = new FrameLayout(this);
        root.addView(screen, new FrameLayout.LayoutParams(0, 0, Gravity.CENTER));
        root.addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int width = right - left;
            int height = bottom - top;
            if (width <= 0 || height <= 0) {
                return;
            }
            if (width == oldRight - oldLeft && height == oldBottom - oldTop) {
                return;
            }
            scale = Math.min(width / (float) DESIGN_WIDTH, height / (float) DESIGN_HEIGHT);
            screen.setLayoutParams(new FrameLayout.LayoutParams(px(DESIGN_WIDTH), px(DESIGN_HEIGHT), Gravity.CENTER));
            showLauncher();
        });
        setContentView(root);

        WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
        if (controller != null) {
            controller.hide(WindowInsets.Type.systemBars());
            controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    /** Home has nowhere to go back to. */
    @Override
    public void onBackPressed() {
    }

    private void showLauncher() {
        screen.removeAllViews();
        place(label("Главная", 33, MUTED, false), 74, 49, 260, 53);
        place(label("Приложения", 58, WHITE, true), 74, 162, 550, 77);
        place(label("Входы", 50, WHITE, true), 74, 650, 350, 73);

        View wifi = topButton("Сеть и Интернет", TileIcon.Glyph.WIFI, "android.settings.WIFI_SETTINGS", 1449);
        View settings = topButton("Настройки", TileIcon.Glyph.SETTINGS, "android.settings.SETTINGS", 1549);
        link(wifi, View.FOCUS_RIGHT, settings);
        link(settings, View.FOCUS_LEFT, wifi);

        float appLabelSize = appLabelSize(px(TILE_WIDTH - 2 * LABEL_INSET));
        View[] tiles = new View[PINNED.length];
        for (int i = 0; i < PINNED.length; i++) {
            App app = PINNED[i];
            tiles[i] = tile(app.label(), app.glyph(), false, () -> openApp(app));
            ((TextView) ((ViewGroup) tiles[i]).getChildAt(1)).setTextSize(TypedValue.COMPLEX_UNIT_PX, appLabelSize);
            place(tiles[i], ROW_LEFT + i * TILE_STEP, TILE_TOP, TILE_WIDTH, TILE_HEIGHT);
        }

        View hdmi1 = tile("HDMI 1", TileIcon.Glyph.HDMI, true, () -> openHdmi(5));
        View hdmi2 = tile("HDMI 2", TileIcon.Glyph.HDMI, true, () -> openHdmi(6));
        place(hdmi1, 71, 739, 347, 114);
        place(hdmi2, 441, 739, 347, 114);

        int last = tiles.length - 1;
        link(hdmi1, View.FOCUS_RIGHT, hdmi2);
        link(hdmi2, View.FOCUS_LEFT, hdmi1);
        link(hdmi1, View.FOCUS_UP, tiles[0]);
        link(hdmi2, View.FOCUS_UP, tiles[2]);
        link(wifi, View.FOCUS_DOWN, tiles[last - 1]);
        link(settings, View.FOCUS_DOWN, tiles[last]);
        for (int i = 0; i < tiles.length; i++) {
            link(tiles[i], View.FOCUS_LEFT, tiles[Math.max(0, i - 1)]);
            link(tiles[i], View.FOCUS_RIGHT, tiles[Math.min(last, i + 1)]);
            link(tiles[i], View.FOCUS_DOWN, i == 0 ? hdmi1 : hdmi2);
            link(tiles[i], View.FOCUS_UP, i == last ? settings : wifi);
        }
        tiles[0].requestFocus();
    }

    /**
     * The original's 36-unit tile label, made smaller for every app tile at once when the widest
     * label would not fit the narrower seven-tile row on one line.
     */
    private float appLabelSize(int labelWidth) {
        Paint measure = new Paint(Paint.ANTI_ALIAS_FLAG);
        measure.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        float size = px(LABEL_SIZE);
        measure.setTextSize(size);
        float widest = 0f;
        for (App app : PINNED) {
            widest = Math.max(widest, measure.measureText(app.label()));
        }
        float room = labelWidth - 2f;
        return widest > room ? (float) Math.floor(size * room / widest) : size;
    }

    private View tile(String text, TileIcon.Glyph glyph, boolean compact, Runnable action) {
        LinearLayout tile = new LinearLayout(this);
        tile.setGravity(Gravity.CENTER);
        tile.setOrientation(compact ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        configureButton(tile, text, compact ? OUTLINE : CARD, 24, action);

        TileIcon icon = new TileIcon(this, glyph);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(
                px(compact ? 81 : 142), px(compact ? 49 : 132));
        if (compact) {
            iconParams.rightMargin = px(26);
        } else {
            iconParams.bottomMargin = px(12);
        }
        tile.addView(icon, iconParams);

        TextView name = label(text, compact ? 35 : LABEL_SIZE, WHITE, true);
        name.setGravity(Gravity.CENTER);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(name, new LinearLayout.LayoutParams(
                compact ? ViewGroup.LayoutParams.WRAP_CONTENT : px(TILE_WIDTH - 2 * LABEL_INSET), px(53)));
        return tile;
    }

    private View topButton(String description, TileIcon.Glyph glyph, String action, int x) {
        FrameLayout button = new FrameLayout(this);
        configureButton(button, description, BACKGROUND, 17, () -> open(new Intent(action), description));
        button.addView(new TileIcon(this, glyph), new FrameLayout.LayoutParams(px(58), px(52), Gravity.CENTER));
        place(button, x, 39, 74, 74);
        return button;
    }

    /** Focusable card: the given outline at rest, a white 5-unit outline when focused. */
    private void configureButton(View view, String description, int outline, int radius, Runnable action) {
        view.setId(View.generateViewId());
        view.setFocusable(true);
        view.setDefaultFocusHighlightEnabled(false);
        view.setContentDescription(description);
        view.setOnClickListener(v -> action.run());
        int fill = outline == BACKGROUND ? BACKGROUND : CARD;
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[] {android.R.attr.state_focused}, card(fill, WHITE, radius, 5));
        background.addState(new int[0], card(fill, outline, radius, 2));
        view.setBackground(background);
    }

    private GradientDrawable card(int color, int stroke, int radius, int strokeWidth) {
        GradientDrawable card = new GradientDrawable();
        card.setColor(color);
        card.setCornerRadius(px(radius));
        card.setStroke(px(strokeWidth), ColorStateList.valueOf(stroke));
        return card;
    }

    private TextView label(String text, int size, int color, boolean medium) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextColor(color);
        label.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(size));
        label.setTypeface(Typeface.create(medium ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        label.setIncludeFontPadding(false);
        label.setGravity(Gravity.CENTER_VERTICAL);
        return label;
    }

    private void place(View view, int x, int y, int width, int height) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(px(width), px(height));
        params.leftMargin = px(x);
        params.topMargin = px(y);
        screen.addView(view, params);
    }

    private int px(int units) {
        return Math.round(units * scale);
    }

    private static void link(View from, int direction, View to) {
        int id = to.getId();
        switch (direction) {
            case View.FOCUS_LEFT -> from.setNextFocusLeftId(id);
            case View.FOCUS_UP -> from.setNextFocusUpId(id);
            case View.FOCUS_RIGHT -> from.setNextFocusRightId(id);
            case View.FOCUS_DOWN -> from.setNextFocusDownId(id);
            default -> throw new IllegalArgumentException("Unknown focus direction");
        }
    }

    private void openApp(App app) {
        Intent intent = appLaunchIntent(app.packageName());
        // «Медиаплеер» prefers VLC and falls back to the TV's own media player.
        if (intent == null && VLC_PACKAGE.equals(app.packageName())) {
            intent = appLaunchIntent(STOCK_MEDIA_PACKAGE);
        }
        open(intent, app.label());
    }

    /** HDMI 1 and 2 are the MediaTek passthrough inputs HW5 and HW6, played by the TV input player. */
    private void openHdmi(int hardwareId) {
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setPackage("com.google.android.tv.inputplayer")
                .setDataAndType(TvContract.buildChannelUriForPassthroughInput(HDMI_INPUT + hardwareId),
                        "vnd.android.cursor.item/channel");
        open(intent, "HDMI " + (hardwareId - 4));
    }

    private Intent appLaunchIntent(String packageName) {
        Intent leanback = getPackageManager().getLeanbackLaunchIntentForPackage(packageName);
        return leanback != null ? leanback : getPackageManager().getLaunchIntentForPackage(packageName);
    }

    private void open(Intent intent, String name) {
        if (intent != null) {
            try {
                startActivity(intent);
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Falls through to the toast.
            }
        }
        Toast.makeText(this, name + " недоступен", Toast.LENGTH_SHORT).show();
    }
}
