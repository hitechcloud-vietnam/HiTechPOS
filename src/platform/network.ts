import { fetch as expoFetch } from "expo/fetch";

// Expo's native transport explicitly disables OkHttp redirects and declines
// URLSession redirection when redirect:error is requested, and omits cookies.
// Do not replace it with React Native's legacy XMLHttpRequest fetch shim.
export const businessFetch = expoFetch as unknown as typeof fetch;
