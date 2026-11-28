package local.tclhome;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;

/**
 * Monochrome tile icons drawn with Canvas on a 100x100 grid, centred and scaled to the view.
 * The coordinates are the original app's, read from its bytecode; SEANS is the one addition.
 */
final class TileIcon extends View {
    private static final int WHITE = 0xFFF7F7F7;
    /** The card colour: punches shapes out of a white fill. */
    private static final int CUTOUT = 0xFF181818;

    enum Glyph { SEANS, SMART_TUBE, LAMPA, YOUTUBE, STORE, MEDIA, TV, HDMI, WIFI, SETTINGS }

    private final Glyph glyph;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path shape = new Path();

    TileIcon(Context context, Glyph glyph) {
        super(context);
        this.glyph = glyph;
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float s = Math.min(getWidth(), getHeight()) / 100f;
        canvas.save();
        canvas.translate((getWidth() - s * 100f) / 2f, (getHeight() - s * 100f) / 2f);
        canvas.scale(s, s);
        stroke(WHITE, 5);
        switch (glyph) {
            case SEANS:
                seans(canvas);
                break;
            case SMART_TUBE:
                monitor(canvas);
                fill(WHITE);
                polygon(canvas, new float[] {45, 33, 64, 45, 45, 57});
                break;
            case TV:
                monitor(canvas);
                canvas.drawLine(35, 8, 50, 22, paint);
                canvas.drawLine(65, 8, 50, 22, paint);
                break;
            case LAMPA:
                fill(WHITE);
                shape.reset();
                shape.moveTo(41, 74);
                shape.cubicTo(41, 62, 23, 54, 23, 36);
                shape.cubicTo(23, 1, 77, 1, 77, 36);
                shape.cubicTo(77, 54, 59, 62, 59, 74);
                shape.close();
                canvas.drawPath(shape, paint);
                stroke(WHITE, 5);
                canvas.drawLine(41, 82, 59, 82, paint);
                canvas.drawLine(45, 90, 55, 90, paint);
                break;
            case YOUTUBE:
                fill(WHITE);
                canvas.drawRoundRect(4, 19, 96, 81, 17, 17, paint);
                fill(CUTOUT);
                polygon(canvas, new float[] {42, 34, 66, 50, 42, 66});
                break;
            case STORE:
                fill(WHITE);
                polygon(canvas, new float[] {16, 12, 53, 50, 16, 88});
                polygon(canvas, new float[] {22, 10, 76, 40, 57, 48});
                polygon(canvas, new float[] {22, 90, 76, 60, 57, 52});
                polygon(canvas, new float[] {61, 50, 80, 41, 94, 50, 80, 59});
                break;
            case MEDIA:
                fill(WHITE);
                canvas.drawRoundRect(8, 37, 92, 88, 6, 6, paint);
                canvas.save();
                canvas.rotate(-12, 11, 35);
                canvas.drawRoundRect(7, 20, 92, 35, 4, 4, paint);
                fill(CUTOUT);
                for (int x = 25; x < 84; x += 21) {
                    polygon(canvas, new float[] {x, 19, x + 7, 19, x - 4, 36, x - 11, 36});
                }
                canvas.restore();
                fill(CUTOUT);
                polygon(canvas, new float[] {43, 49, 63, 62, 43, 75});
                break;
            case HDMI:
                polygon(canvas, new float[] {6, 27, 94, 27, 94, 56, 80, 71, 20, 71, 6, 56});
                canvas.drawLine(20, 48, 80, 48, paint);
                for (int x = 24; x <= 76; x += 13) {
                    canvas.drawLine(x, 48, x, 57, paint);
                }
                break;
            case WIFI:
                stroke(WHITE, 7);
                canvas.drawArc(-2, 20, 102, 123, 226, 88, false, paint);
                canvas.drawArc(16, 38, 84, 106, 226, 88, false, paint);
                canvas.drawArc(33, 56, 67, 90, 226, 88, false, paint);
                fill(WHITE);
                canvas.drawCircle(50, 75, 4, paint);
                break;
            case SETTINGS:
                shape.reset();
                for (int i = 0; i < 32; i++) {
                    double angle = i * Math.PI / 16.0;
                    int radius = i % 4 < 2 ? 40 : 33;
                    float x = radius * (float) Math.cos(angle) + 50f;
                    float y = radius * (float) Math.sin(angle) + 50f;
                    if (i == 0) {
                        shape.moveTo(x, y);
                    } else {
                        shape.lineTo(x, y);
                    }
                }
                shape.close();
                canvas.drawPath(shape, paint);
                canvas.drawCircle(50, 50, 15, paint);
                break;
        }
        canvas.restore();
    }

    /** A monitor outline on a stand (SmartTube, TV). */
    private void monitor(Canvas canvas) {
        canvas.drawRoundRect(6, 22, 94, 70, 9, 9, paint);
        canvas.drawLine(50, 70, 50, 83, paint);
        canvas.drawLine(31, 84, 69, 84, paint);
    }

    /**
     * «Сеанс»: the app logo, a clapperboard with a play triangle, drawn in outline like the
     * monitor glyphs so it stays distinct from the solid «Медиаплеер» clapperboard.
     */
    private void seans(Canvas canvas) {
        canvas.drawRoundRect(10, 46, 90, 88, 8, 8, paint);
        canvas.save();
        canvas.rotate(-12, 10, 39);
        canvas.drawRoundRect(10, 24, 90, 39, 5, 5, paint);
        for (int x = 26; x <= 66; x += 20) {
            canvas.drawLine(x, 39, x + 10, 24, paint);
        }
        canvas.restore();
        fill(WHITE);
        polygon(canvas, new float[] {43, 55, 61, 67, 43, 79});
    }

    private void polygon(Canvas canvas, float[] points) {
        shape.reset();
        shape.moveTo(points[0], points[1]);
        for (int i = 2; i < points.length; i += 2) {
            shape.lineTo(points[i], points[i + 1]);
        }
        shape.close();
        canvas.drawPath(shape, paint);
    }

    private void fill(int color) {
        paint.setColor(color);
        paint.setStyle(Paint.Style.FILL);
    }

    private void stroke(int color, int width) {
        paint.setColor(color);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(width);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeCap(Paint.Cap.ROUND);
    }
}
