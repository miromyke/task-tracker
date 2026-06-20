import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import App from "./App";
import { activateLocale, detectLocale } from "./i18n";
import "./index.css";

async function bootstrap() {
  await activateLocale(detectLocale());
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </React.StrictMode>
  );
}

bootstrap();
