import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
const native =
  Platform.OS === "web"
    ? null
    : requireOptionalNativeModule<{
        readText(base64: string): Promise<string[]>;
      }>("PosnicRecognition");
export const localPhotoReading = !!native;
export async function readLocalPhoto(image: string): Promise<string[]> {
  if (!native) throw Error("photoLocalUnavailable");
  return native.readText(image.split(",")[1] ?? "");
}
