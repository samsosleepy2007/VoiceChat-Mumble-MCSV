package se.lublin.mumla.preference;

import static java.util.Objects.requireNonNull;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;

import androidx.preference.Preference;

import info.guardianproject.netcipher.proxy.OrbotHelper;
import se.lublin.mumla.R;

public class GeneralSettingsFragment extends MumlaPreferenceFragment {
    private static final String USE_TOR_KEY = "useTor";
    private static final String VC_BATTERY_KEY = "vc_battery_unrestricted"; // VC_BATTERY_UNRESTRICTED_SETTINGS

    @Override
    public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
        setPreferencesFromResource(R.xml.settings_general, rootKey);

        Preference useOrbotPreference = getPreferenceScreen().findPreference(USE_TOR_KEY);
        requireNonNull(useOrbotPreference).setEnabled(OrbotHelper.isOrbotInstalled(requireContext()));

        Preference batteryPreference = getPreferenceScreen().findPreference(VC_BATTERY_KEY);
        requireNonNull(batteryPreference).setOnPreferenceClickListener(preference -> {
            requestVcBatteryUnrestricted();
            return true;
        });
        updateVcBatteryPreference();
    }

    @Override
    public void onResume() {
        super.onResume();
        updateVcBatteryPreference();
    }

    private boolean isVcBatteryUnrestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager powerManager =
                (PowerManager) requireContext().getSystemService(android.content.Context.POWER_SERVICE);
        return powerManager != null
                && powerManager.isIgnoringBatteryOptimizations(requireContext().getPackageName());
    }

    private void updateVcBatteryPreference() {
        Preference preference = getPreferenceScreen().findPreference(VC_BATTERY_KEY);
        if (preference == null) {
            return;
        }
        preference.setSummary(
                isVcBatteryUnrestricted()
                        ? R.string.vc_battery_unrestricted_enabled
                        : R.string.vc_battery_unrestricted_disabled
        );
    }

    private void requestVcBatteryUnrestricted() {
        if (isVcBatteryUnrestricted()) {
            updateVcBatteryPreference();
            return;
        }
        try {
            Intent request = new Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + requireContext().getPackageName())
            );
            startActivity(request);
        } catch (Exception error) {
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
                startActivity(new Intent(
                        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + requireContext().getPackageName())
                ));
            }
        }
    }
}
