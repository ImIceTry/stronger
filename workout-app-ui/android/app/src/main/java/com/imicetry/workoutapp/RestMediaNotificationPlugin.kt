package com.imicetry.workoutapp

import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media.app.NotificationCompat.MediaStyle
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.github.d4viddf.hyperisland_kit.HyperAction
import io.github.d4viddf.hyperisland_kit.HyperIslandNotification
import io.github.d4viddf.hyperisland_kit.HyperPicture

// Posts the rest-timer countdown as a real notification, preferring Xiaomi's
// actual Focus Notification/Super Island system (2026-09-18/19, ImIceTry's ask
// after seeing Spotify render as a live pill in HyperOS's status-bar Island)
// over the generic MediaSession fallback this started as. See
// io.github.d4viddf.hyperisland_kit (vendored -- not on Maven Central, its
// Jitpack builds are broken as of this writing) for the real mechanism:
// undocumented `miui.focus.*` notification extras, including a genuine
// TimerInfo that HyperOS renders as a live countdown, the same way Android's
// own Chronometer works. HyperIslandNotification.isSupported() is false on
// any non-Xiaomi device (or if the user hasn't granted the OS's own Focus
// permission), in which case this falls back to the plain MediaSessionCompat
// pill built 2026-09-18 -- generic icon+soundwave, no live text, but still
// something, and works on any Android phone.
//
// Reuses the SAME notification id (1) and channel ("workout_active") the
// @capawesome-team ForegroundService plugin already started the foreground
// service with -- posting a replacement Notification for an already-active
// foreground id via NotificationManagerCompat.notify() keeps the service in
// its foreground state without a second, duplicate notification appearing.
@CapacitorPlugin(name = "RestMediaNotification")
class RestMediaNotificationPlugin : Plugin() {
    companion object {
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "workout_active"
        private const val PIC_KEY = "workout_icon"
        private const val ACTION_REST_BUTTON = "com.imicetry.workoutapp.REST_TIMER_ACTION"
        private const val EXTRA_BUTTON = "button"
    }

    private var mediaSession: MediaSessionCompat? = null
    private var receiverRegistered = false

    // -30s/+30s/Skip (2026-09-19, restoring parity with the plain
    // ForegroundService notification these replaced, which already had
    // real buttons -- ImIceTry noticed they were gone once this switched to
    // the HyperOS/MediaSession-based notification). A BroadcastReceiver is
    // a fresh instance per broadcast with no link back to this plugin
    // object, so it just forwards the tapped button's name to JS via
    // notifyListeners -- app-rest-timer.js's own addListener wires each
    // name to the exact same adjustLiveRestTimer/skipLiveRestFromNotification
    // calls the old notification's buttons used.
    private val actionReceiver = object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context, intent: Intent) {
            val button = intent.getStringExtra(EXTRA_BUTTON) ?: return
            val ret = JSObject()
            ret.put("button", button)
            notifyListeners("buttonClicked", ret)
        }
    }

    override fun load() {
        super.load()
        val filter = IntentFilter(ACTION_REST_BUTTON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(actionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            getContext().registerReceiver(actionReceiver, filter)
        }
        receiverRegistered = true
    }

    override fun handleOnDestroy() {
        if (receiverRegistered) {
            try {
                getContext().unregisterReceiver(actionReceiver)
            } catch (e: Exception) {
                // Already unregistered (e.g. onDestroy firing twice) -- harmless.
            }
            receiverRegistered = false
        }
        super.handleOnDestroy()
    }

    @PluginMethod
    fun show(call: PluginCall) {
        val title = call.getString("title", "Resting") ?: "Resting"
        val body = call.getString("body", "") ?: ""
        val remainingSec = call.getInt("remainingSec", 0) ?: 0
        val context = getContext()

        // Real bug (2026-09-19, ImIceTry: completing a set from the OLD
        // idle notification's own button, not from inside the app, made
        // the Island not come back for the next rest period). Without a
        // try/catch here, any failure in the HyperOS path -- most likely
        // isSupported()'s own ContentResolver IPC call to the system's
        // notification service behaving differently when this whole chain
        // (completeSetFromNotification -> logSet -> startRestTimer) runs
        // off a broadcast-receiver-originated JS event instead of a normal
        // in-app tap -- would leave call unresolved, so the JS side's own
        // try/catch around RestMediaNotificationPlugin.show() never even
        // gets a rejection to catch, and its fallback to the plain
        // ForegroundServicePlugin path never runs either. Always resolving
        // (falling back on any native-side failure too, not just an
        // unsupported device) means the notification always ends up in
        // SOME real state instead of possibly none at all.
        try {
            if (HyperIslandNotification.isSupported(context)) {
                showHyperIsland(context, title, body, remainingSec)
            } else {
                showMediaSessionFallback(context, title, body)
            }
        } catch (e: Exception) {
            try {
                showMediaSessionFallback(context, title, body)
            } catch (e2: Exception) {
                // Truly nothing left to fall back to -- resolve anyway so the
                // JS side doesn't hang waiting on a call that will never
                // finish; the caller's own try/catch handles a rejection, but
                // a hang is worse than a no-op notification update.
            }
        }
        call.resolve()
    }

    private fun buttonIntent(context: Context, button: String, requestCode: Int): PendingIntent {
        val intent = Intent(ACTION_REST_BUTTON).setPackage(context.packageName).putExtra(EXTRA_BUTTON, button)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getBroadcast(context, requestCode, intent, flags)
    }

    private fun showHyperIsland(context: Context, title: String, body: String, remainingSec: Int) {
        val endTimeMillis = System.currentTimeMillis() + (remainingSec.coerceAtLeast(0) * 1000L)
        val pic = HyperPicture(PIC_KEY, context, R.drawable.ic_stat_workout)

        // actionIntentType 2 = Broadcast (see HyperAction's own doc comment).
        val minus30 = HyperAction("minus30", "-30s", buttonIntent(context, "minus30", 1), 2)
        val plus30 = HyperAction("plus30", "+30s", buttonIntent(context, "plus30", 2), 2)
        val skip = HyperAction("skip", "Skip", buttonIntent(context, "skip", 3), 2)

        // islandFirstFloat defaults to true in the library, which replays the
        // "just appeared" expand animation on every single update -- since
        // we repost this notification once a second while resting, that kept
        // it visually stuck open as a big expanded card instead of settling
        // into the small collapsed pill (2026-09-19, seen live on ImIceTry's
        // phone). false lets each update refresh the pill's content quietly.
        val builder = HyperIslandNotification.Builder(context, "workout_rest", title)
            .addPicture(pic)
            .addAction(minus30)
            .addAction(plus30)
            .addAction(skip)
            .setChatInfo(title = title, content = body, pictureKey = PIC_KEY, actionKeys = listOf("minus30", "plus30", "skip"))
            .setBigIslandCountdown(endTimeMillis, PIC_KEY)
            .setSmallIsland(PIC_KEY)
            .setIslandFirstFloat(false)
            // expandedTimeMs defaults to null (stay expanded indefinitely) --
            // setIslandFirstFloat(false) alone didn't fix the stuck-open big
            // card (2026-09-19, confirmed live), so this is the actual knob:
            // 2.5s expanded, then it collapses to the small pill on its own.
            .setIslandConfig(expandedTimeMs = 2500)

        val resourceBundle = builder.buildResourceBundle()
        val jsonParam = builder.buildJsonParam()

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_stat_workout)
            .setContentIntent(openAppIntent(context))
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .addExtras(resourceBundle)
            // Real notification-shade actions, separate from the island's own
            // action bundle above -- these are what actually show up when you
            // pull down the shade or long-press to expand (2026-09-19,
            // ImIceTry: "the notification just says resting... with no buttons").
            .addAction(0, "-30s", buttonIntent(context, "minus30", 1))
            .addAction(0, "+30s", buttonIntent(context, "plus30", 2))
            .addAction(0, "Skip", buttonIntent(context, "skip", 3))
            .build()
        notification.extras.putString("miui.focus.param", jsonParam)

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    private fun showMediaSessionFallback(context: Context, title: String, body: String) {
        val session = mediaSession ?: MediaSessionCompat(context, "WorkoutRestTimer").also { mediaSession = it }
        session.isActive = true
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, body)
                .build()
        )
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_STOP)
                .setState(PlaybackStateCompat.STATE_PLAYING, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build()
        )

        val notification: Notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_stat_workout)
            .setContentIntent(openAppIntent(context))
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "-30s", buttonIntent(context, "minus30", 1))
            .addAction(0, "+30s", buttonIntent(context, "plus30", 2))
            .addAction(0, "Skip", buttonIntent(context, "skip", 3))
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    private fun openAppIntent(context: Context): PendingIntent? {
        val openApp = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getActivity(context, 0, openApp, flags)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        mediaSession?.let {
            it.isActive = false
            it.release()
            mediaSession = null
        }
        call.resolve()
    }
}
