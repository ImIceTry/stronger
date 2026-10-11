package com.imicetry.workoutapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RestMediaNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
