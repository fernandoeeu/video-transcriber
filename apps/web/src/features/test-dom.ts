// @ts-expect-error -- This app does not install the optional jsdom type package.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

const browserGlobals = {
  document: dom.window.document,
  Event: dom.window.Event,
  EventTarget: dom.window.EventTarget,
  HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  window: dom.window,
};

for (const [name, value] of Object.entries(browserGlobals)) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});
