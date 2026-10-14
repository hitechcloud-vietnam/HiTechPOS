import * as Network from "expo-network";
export async function wifiAddress(): Promise<string> {
  const network = await Network.getNetworkStateAsync();
  if (network.type !== Network.NetworkStateType.WIFI || !network.isConnected)
    throw new Error("wifiRequired");
  return Network.getIpAddressAsync();
}
