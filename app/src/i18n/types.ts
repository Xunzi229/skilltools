export type Locale = "zh" | "en";

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

/** Same shape as the Chinese catalog; English must satisfy this type. */
export type Messages = DeepStringify<typeof import("./zh").zh>;
