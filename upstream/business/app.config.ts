import { type ExpoConfig } from "expo/config";
import config from "./app.json";
import permissionDescriptions from "./src/i18n/native-permissions.json";

const projectId = process.env.POSNIC_BUSINESS_EXPO_PROJECT_ID;
if (projectId && !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(projectId))
  throw new Error(
    "POSNIC_BUSINESS_EXPO_PROJECT_ID must be an EAS project UUID",
  );
export default {
  ...config.expo,
  locales: Object.fromEntries(
    Object.entries(permissionDescriptions).map(([code, description]) => [
      code,
      { ios: { NSFaceIDUsageDescription: description } },
    ]),
  ),
  ios: {
    ...config.expo.ios,
    buildNumber:
      process.env.POSNIC_IOS_BUILD_NUMBER || config.expo.ios.buildNumber,
    infoPlist: {
      CFBundleDevelopmentRegion: "en",
      CFBundleLocalizations: Object.keys(permissionDescriptions),
    },
  },
  android: {
    ...config.expo.android,
    predictiveBackGestureEnabled: false,
    ...(process.env.POSNIC_BUSINESS_GOOGLE_SERVICES_FILE
      ? { googleServicesFile: process.env.POSNIC_BUSINESS_GOOGLE_SERVICES_FILE }
      : {}),
  },
  plugins: [
    ...config.expo.plugins,
    "./plugins/withBusinessNavigation.js",
    ["expo-notifications", { defaultChannel: "business-updates" }],
  ],
  ...(projectId ? { extra: { eas: { projectId } } } : {}),
} as ExpoConfig;
