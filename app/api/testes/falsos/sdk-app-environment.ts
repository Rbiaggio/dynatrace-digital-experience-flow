/* @dynatrace-sdk/app-environment falso: a identidade que a plataforma daria à função (o teste troca em globalThis). */
const g = globalThis as unknown as { __DEF_USUARIO?: { id: string; name: string; email: string } };
export const getCurrentUserDetails = () => g.__DEF_USUARIO ?? { id: "dt.missing.user.id", name: "dt.missing.user.name", email: "dt.missing.user.email" };
export const getEnvironmentId = () => "abc12345";
export const getEnvironmentUrl = () => "https://abc12345.apps.dynatrace.com";
export const getAppVersion = () => "1.33.1";
export const getAppId = () => "my.digital.experience.flow";
