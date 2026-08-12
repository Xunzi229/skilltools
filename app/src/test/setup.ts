import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetLocale } from "../i18n";

localStorage.removeItem("skilltools.locale");
resetLocale("zh");

beforeEach(() => {
  localStorage.removeItem("skilltools.locale");
  resetLocale("zh");
});
