package app.bricksvault;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.text.format.DateFormat;
import android.widget.RemoteViews;

import java.util.Date;

/**
 * Home-screen widget: vault value + daily delta at a glance, tap to open the
 * app. Values come from SharedPreferences (pushed by WidgetBridgePlugin after
 * each portfolio load) — the widget does no work of its own, so it costs
 * nothing in battery and can never show half-loaded state.
 */
public class VaultWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(WidgetBridgePlugin.KEY_VALUE, "Open the app");
        String delta = prefs.getString(WidgetBridgePlugin.KEY_DELTA, "");
        boolean deltaUp = prefs.getBoolean(WidgetBridgePlugin.KEY_DELTA_UP, true);
        int sets = prefs.getInt(WidgetBridgePlugin.KEY_SETS, 0);
        long updatedAt = prefs.getLong(WidgetBridgePlugin.KEY_UPDATED, 0L);

        // "N sets · updated 14:57" footer — only once the app has pushed data.
        String meta;
        if (updatedAt > 0) {
            String time = DateFormat.getTimeFormat(context).format(new Date(updatedAt));
            meta = sets + (sets == 1 ? " set · " : " sets · ") + "updated " + time;
        } else {
            meta = "Open the app to sync";
        }

        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_vault);
            views.setTextViewText(R.id.widget_value, value);
            views.setTextViewText(R.id.widget_delta, delta);
            views.setTextColor(R.id.widget_delta,
                Color.parseColor(deltaUp ? "#2c7a4b" : "#b3402a"));
            views.setTextViewText(R.id.widget_meta, meta);

            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_root, pi);

            appWidgetManager.updateAppWidget(id, views);
        }
    }
}
