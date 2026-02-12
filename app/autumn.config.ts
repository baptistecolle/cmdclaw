import {
  feature,
  product,
  featureItem,
  pricedFeatureItem,
  priceItem,
} from "atmn";

// Features
export const messages = feature({
  id: "messages",
  name: "Messages",
  type: "single_use",
});

export const e2bSandbox = feature({
  id: "e2b_sandbox",
  name: "E2B Cloud Sandbox",
  type: "boolean",
});

// Products
export const free = product({
  id: "free",
  name: "Free",
  is_default: true,
  items: [],
});

export const pro = product({
  id: "pro",
  name: "Pro",
  items: [
    featureItem({
      feature_id: messages.id,
      included_usage: 10000,
      interval: "month",
    }),
    featureItem({ feature_id: e2bSandbox.id }),
    priceItem({ price: 30, interval: "month" }),
  ],
});
