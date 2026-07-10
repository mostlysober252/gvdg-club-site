import React from "react";

const h = React.createElement;

const CATEGORY_OPTIONS = [
  ["disc", "Disc"],
  ["accessory", "Accessory"],
];

const TYPE_OPTIONS = [
  ["distance_driver", "Distance driver"],
  ["fairway_driver", "Fairway driver"],
  ["midrange", "Midrange"],
  ["putter", "Putter"],
  ["approach", "Approach"],
  ["bag", "Bag"],
  ["apparel", "Apparel"],
  ["accessory", "Accessory"],
];

const EMPTY_FORM = {
  brand: "",
  category: "disc",
  color: "",
  description: "",
  imageUrl: "",
  name: "",
  price: "",
  productType: "distance_driver",
  stock: "1",
  uploadedImageUrl: "",
  weight: "",
};

const hInput = "input";

function dispatchRequest(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function dollarsToCents(value) {
  const numberValue = parseFloat(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) : null;
}

function positiveIntOrNull(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}

function optionNodes(options) {
  return options.map(([value, label]) => h("option", { key: value, value }, label));
}

function formBody(form) {
  const price = dollarsToCents(form.price);
  return {
    body: {
      brand: form.brand.trim() || null,
      category: form.category,
      color: form.color.trim() || null,
      description: form.description.trim() || null,
      image_url: form.uploadedImageUrl || form.imageUrl.trim() || null,
      name: form.name.trim(),
      price_cents: price,
      product_type: form.productType || null,
      stock_qty: nonNegativeInt(form.stock),
      weight_g: positiveIntOrNull(form.weight),
    },
    valid: Boolean(form.name.trim() && price != null),
  };
}

export function AdminProductForm() {
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);
  const requestCounter = React.useRef(0);
  const currentRequest = React.useRef("");

  React.useEffect(() => {
    function update(event) {
      const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
      if (!detail.requestId || detail.requestId !== currentRequest.current) return;
      setBusy(false);
      if (detail.ok === true) {
        setForm(EMPTY_FORM);
        if (fileRef.current) fileRef.current.value = "";
        currentRequest.current = "";
      }
    }
    window.addEventListener("gvdg:admin-product-create-result", update);
    return () => window.removeEventListener("gvdg:admin-product-create-result", update);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function updateFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 700, 0.78);
      setForm((current) => ({ ...current, imageUrl: "", uploadedImageUrl: dataUrl }));
      dispatchRequest("gvdg:admin-product-photo-ready", { sizeKb: Math.round(dataUrl.length / 1024) });
    } catch {
      dispatchRequest("gvdg:admin-product-photo-error", {});
    }
  }

  function updateImageUrl(value) {
    setForm((current) => ({ ...current, imageUrl: value, uploadedImageUrl: value ? "" : current.uploadedImageUrl }));
    if (value && fileRef.current) fileRef.current.value = "";
  }

  function submit(event) {
    event.preventDefault();
    const payload = formBody(form);
    const requestId = `product-create-${requestCounter.current += 1}`;
    currentRequest.current = requestId;
    setBusy(true);
    dispatchRequest("gvdg:admin-product-create-request", { ...payload, requestId });
    if (!payload.valid) setBusy(false);
  }

  return h("form", {
    className: "admin-form",
    "data-react-admin-product-form": "ready",
    id: "adminProductForm",
    onSubmit: submit,
  }, [
    h("div", { key: "category" }, [
      h("label", { htmlFor: "psCategory", key: "label" }, "Category"),
      h("select", { id: "psCategory", key: "input", onChange: (event) => updateField("category", event.target.value), value: form.category }, optionNodes(CATEGORY_OPTIONS)),
    ]),
    h("div", { key: "name" }, [
      h("label", { htmlFor: "psName", key: "label" }, "Product name"),
      h(hInput, { id: "psName", key: "input", maxLength: 160, onChange: (event) => updateField("name", event.target.value), required: true, value: form.name }),
    ]),
    h("div", { key: "brand" }, [
      h("label", { htmlFor: "psBrand", key: "label" }, "Brand"),
      h(hInput, { id: "psBrand", key: "input", maxLength: 80, onChange: (event) => updateField("brand", event.target.value), placeholder: "Innova, Discraft, MVP", value: form.brand }),
    ]),
    h("div", { key: "type" }, [
      h("label", { htmlFor: "psType", key: "label" }, "Type"),
      h("select", { id: "psType", key: "input", onChange: (event) => updateField("productType", event.target.value), value: form.productType }, optionNodes(TYPE_OPTIONS)),
    ]),
    h("div", { key: "color" }, [
      h("label", { htmlFor: "psColor", key: "label" }, "Color"),
      h(hInput, { id: "psColor", key: "input", maxLength: 60, onChange: (event) => updateField("color", event.target.value), value: form.color }),
    ]),
    h("div", { key: "weight" }, [
      h("label", { htmlFor: "psWeight", key: "label" }, "Weight (g)"),
      h(hInput, { id: "psWeight", key: "input", min: "0", onChange: (event) => updateField("weight", event.target.value), step: "1", type: "number", value: form.weight }),
    ]),
    h("div", { key: "price" }, [
      h("label", { htmlFor: "psPrice", key: "label" }, "Price ($)"),
      h(hInput, { id: "psPrice", key: "input", min: "0", onChange: (event) => updateField("price", event.target.value), required: true, step: "0.01", type: "number", value: form.price }),
    ]),
    h("div", { key: "stock" }, [
      h("label", { htmlFor: "psStock", key: "label" }, "Stock"),
      h(hInput, { id: "psStock", key: "input", min: "0", onChange: (event) => updateField("stock", event.target.value), step: "1", type: "number", value: form.stock }),
    ]),
    h("div", { className: "admin-product-form-wide", key: "image" }, [
      h("label", { htmlFor: "psImage", key: "label" }, "Image"),
      h(hInput, { id: "psImage", key: "url", maxLength: 2000, onChange: (event) => updateImageUrl(event.target.value), placeholder: "https://... paste an image URL", type: "url", value: form.imageUrl }),
      h("div", { className: "admin-product-image-input", key: "file-row" }, [
        h(hInput, { accept: "image/*", id: "psImageFile", key: "file", onChange: updateFile, ref: fileRef, type: "file" }),
        h("span", { className: "al-note", key: "note" }, "...or take a photo / upload from your device"),
      ]),
      form.uploadedImageUrl ? h("figure", {
        className: "admin-product-image-preview",
        "data-react-admin-product-image-preview": "ready",
        key: "preview",
      }, [
        h("img", {
          alt: "Selected product preview",
          className: "shop-admin-thumb admin-product-image-preview-img",
          key: "image",
          src: form.uploadedImageUrl,
        }),
        h("figcaption", { className: "admin-product-image-preview-note", key: "caption" }, "Selected upload will be saved when you add the product."),
      ]) : null,
    ]),
    h("div", { className: "admin-product-form-wide", key: "description" }, [
      h("label", { htmlFor: "psDescription", key: "label" }, "Description"),
      h("textarea", { id: "psDescription", key: "input", maxLength: 1000, onChange: (event) => updateField("description", event.target.value), rows: 3, value: form.description }),
    ]),
    h("button", { className: "admin-btn", disabled: busy, key: "submit", type: "submit" }, busy ? "Adding..." : "Add product"),
  ]);
}
