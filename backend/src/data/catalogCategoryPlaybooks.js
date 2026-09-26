/**
 * GENERATED FILE — canonical seed snapshot from the Catalog Guidance Book.
 * Regenerate with: npm run catalog:taxonomy:sync
 * Do not edit manually.
 */
export const CATEGORY_PLAYBOOKS = [
  {
    "id": "fresh-flowers",
    "group": "Flowers & plants",
    "name": "Fresh flowers",
    "aliases": [
      "cut flowers",
      "roses",
      "lilies",
      "marigold"
    ],
    "kind": "physical",
    "summary": "Cut stems, loose flowers and bunches whose freshness, grade and cold-chain profile affect the buying decision.",
    "unitPolicy": "Mass or count. Use stem/bunch for count products and g/kg for loose flowers; declare conversions explicitly.",
    "variantAxes": [
      "colour",
      "stem_count",
      "grade",
      "pack_size"
    ],
    "attributes": [
      {
        "key": "botanical_name",
        "label": "Botanical name",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "flower_variety",
        "label": "Flower variety",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "options": [
          "red",
          "white",
          "yellow",
          "pink",
          "orange",
          "purple",
          "green",
          "mixed"
        ],
        "searchable": true,
        "filterable": true,
        "facetable": true,
        "group": "Appearance"
      },
      {
        "key": "stem_length_cm",
        "label": "Stem length",
        "type": "number",
        "appliesTo": "variant",
        "required": false,
        "unit": "cm",
        "min": 1,
        "max": 250,
        "filterable": true,
        "group": "Grade"
      },
      {
        "key": "stem_count",
        "label": "Stem count",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "stems",
        "min": 1,
        "group": "Pack"
      },
      {
        "key": "grade",
        "label": "Trade grade",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "options": [
          "standard",
          "premium",
          "export"
        ],
        "filterable": true,
        "group": "Grade"
      },
      {
        "key": "vase_life_days",
        "label": "Expected vase life",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "days",
        "min": 1,
        "max": 45,
        "filterable": true,
        "group": "Care"
      },
      {
        "key": "fragrance",
        "label": "Fragrance strength",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "options": [
          "none",
          "mild",
          "medium",
          "strong"
        ],
        "filterable": true,
        "group": "Experience"
      },
      {
        "key": "care_instructions",
        "label": "Care instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Care"
      }
    ],
    "compliance": [
      {
        "code": "PLANT_QUARANTINE_IMPORT",
        "type": "certificate",
        "label": "Phytosanitary / plant-quarantine clearance for imported consignments",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Packaged-commodity declarations when sold in a pre-packed unit",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Premium Red Roses — 20 Stems",
      "sku": "FLW-ROS-RED-20",
      "options": "colour=Red; stem_count=20",
      "listing": "MRP ₹699, selling ₹599, price basis 1 bunch, stock 42, lead time 0 days"
    }
  },
  {
    "id": "bouquets",
    "group": "Flowers & plants",
    "name": "Bouquets & floral arrangements",
    "aliases": [
      "flower bouquet",
      "arrangement",
      "wreath"
    ],
    "kind": "bundle",
    "summary": "Designed arrangements composed from flowers, foliage, wrapping, containers and optional gifts.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "size",
      "colour_theme",
      "stem_count",
      "vase_option"
    ],
    "attributes": [
      {
        "key": "occasion",
        "label": "Occasion",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "options": [
          "birthday",
          "anniversary",
          "wedding",
          "sympathy",
          "congratulations",
          "festival"
        ],
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Use"
      },
      {
        "key": "flower_mix",
        "label": "Flower mix",
        "type": "multi_select",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Composition"
      },
      {
        "key": "dominant_color",
        "label": "Dominant colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Appearance"
      },
      {
        "key": "stem_count",
        "label": "Approximate stem count",
        "type": "number",
        "appliesTo": "variant",
        "required": false,
        "min": 1,
        "group": "Composition"
      },
      {
        "key": "arrangement_style",
        "label": "Arrangement style",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "options": [
          "hand_tied",
          "wrapped",
          "basket",
          "vase",
          "box",
          "wreath"
        ],
        "filterable": true,
        "group": "Design"
      },
      {
        "key": "size",
        "label": "Arrangement size",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "options": [
          "small",
          "medium",
          "large",
          "grand"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Size"
      },
      {
        "key": "care_instructions",
        "label": "Care instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Care"
      }
    ],
    "compliance": [
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Packaged-commodity declarations where sold as a pre-packed article",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Blush Rose Celebration Bouquet",
      "sku": "BOUQ-BLUSH-M",
      "options": "size=Medium; colour_theme=Blush",
      "listing": "MRP ₹1,299, selling ₹1,099, stock 12, lead time 1 day"
    }
  },
  {
    "id": "live-plants",
    "group": "Flowers & plants",
    "name": "Live plants",
    "aliases": [
      "plants",
      "indoor plants",
      "outdoor plants"
    ],
    "kind": "physical",
    "summary": "Live ornamental, indoor, outdoor and nursery plants, with pot and maturity variations.",
    "unitPolicy": "Count; base unit plant or piece.",
    "variantAxes": [
      "pot_size",
      "plant_height",
      "pot_color"
    ],
    "attributes": [
      {
        "key": "botanical_name",
        "label": "Botanical name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "common_name",
        "label": "Common name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "plant_type",
        "label": "Plant type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "indoor",
          "outdoor",
          "succulent",
          "flowering",
          "herb",
          "tree",
          "aquatic"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Growing profile"
      },
      {
        "key": "sunlight",
        "label": "Sunlight requirement",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "low_light",
          "indirect",
          "partial_sun",
          "full_sun"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Care"
      },
      {
        "key": "watering",
        "label": "Watering frequency",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "low",
          "moderate",
          "frequent"
        ],
        "filterable": true,
        "group": "Care"
      },
      {
        "key": "plant_height_cm",
        "label": "Plant height",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "cm",
        "min": 1,
        "filterable": true,
        "group": "Size"
      },
      {
        "key": "pot_diameter_cm",
        "label": "Pot diameter",
        "type": "number",
        "appliesTo": "variant",
        "required": false,
        "unit": "cm",
        "min": 1,
        "group": "Size"
      },
      {
        "key": "pet_safe",
        "label": "Pet safe",
        "type": "boolean",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Safety"
      },
      {
        "key": "care_instructions",
        "label": "Care instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Care"
      }
    ],
    "compliance": [
      {
        "code": "PLANT_QUARANTINE_IMPORT",
        "type": "certificate",
        "label": "Phytosanitary / plant-quarantine clearance for imported plants",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "CITES_PLANT",
        "type": "certificate",
        "label": "CITES permit for protected species",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      }
    ],
    "example": {
      "title": "Golden Money Plant in 5-inch Pot",
      "sku": "PLT-MONEY-GOLD-5",
      "options": "pot_size=5 inch; pot_color=White",
      "listing": "MRP ₹349, selling ₹299, stock 24, storefront on"
    }
  },
  {
    "id": "seeds-bulbs",
    "group": "Flowers & plants",
    "name": "Seeds, bulbs & planting material",
    "aliases": [
      "seeds",
      "bulbs",
      "saplings"
    ],
    "kind": "physical",
    "summary": "Seeds and propagating material where lot, germination and treatment disclosures are critical.",
    "unitPolicy": "Count or mass according to pack declaration.",
    "variantAxes": [
      "pack_size",
      "variety"
    ],
    "attributes": [
      {
        "key": "crop_or_species",
        "label": "Crop / species",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "variety",
        "label": "Variety",
        "type": "string",
        "appliesTo": "variant",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "seed_count",
        "label": "Approximate seed count",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 1,
        "group": "Pack"
      },
      {
        "key": "net_weight_g",
        "label": "Net weight",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "g",
        "min": 0.01,
        "group": "Pack"
      },
      {
        "key": "germination_percent",
        "label": "Minimum germination",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "%",
        "min": 0,
        "max": 100,
        "group": "Quality"
      },
      {
        "key": "lot_number",
        "label": "Lot number",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      },
      {
        "key": "test_date",
        "label": "Test date",
        "type": "date",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      },
      {
        "key": "treated",
        "label": "Chemically treated",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "group": "Safety"
      },
      {
        "key": "sowing_season",
        "label": "Sowing season",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Growing guide"
      }
    ],
    "compliance": [
      {
        "code": "SEEDS_ACT_LABEL",
        "type": "standard",
        "label": "Seeds Act / Rules labelling and quality declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "PLANT_QUARANTINE_IMPORT",
        "type": "certificate",
        "label": "Import permit and phytosanitary certificate for imported planting material",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      }
    ],
    "example": {
      "title": "Hybrid Marigold Seeds — Orange, 100 Seeds",
      "sku": "SEED-MAR-ORG-100",
      "options": "variety=Orange; pack_size=100",
      "listing": "MRP ₹120, selling ₹99, stock 180"
    }
  },
  {
    "id": "smartphones",
    "group": "Electronics",
    "name": "Smartphones",
    "aliases": [
      "mobile phones",
      "android phone",
      "iphone",
      "5g phone"
    ],
    "kind": "physical",
    "summary": "Cellular handsets. Model identity must be stable; RAM, storage and colour normally form variant identity.",
    "unitPolicy": "Count; base unit piece. Never encode storage or colour only in the listing title.",
    "variantAxes": [
      "ram",
      "storage",
      "color"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "operating_system",
        "label": "Operating system",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "Android",
          "iOS",
          "Other"
        ],
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Platform"
      },
      {
        "key": "ram_gb",
        "label": "RAM",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "GB",
        "min": 1,
        "max": 64,
        "filterable": true,
        "facetable": true,
        "group": "Performance"
      },
      {
        "key": "storage_gb",
        "label": "Storage",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "GB",
        "min": 4,
        "max": 4096,
        "filterable": true,
        "facetable": true,
        "group": "Performance"
      },
      {
        "key": "display_size_in",
        "label": "Display size",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "in",
        "min": 2,
        "max": 12,
        "filterable": true,
        "group": "Display"
      },
      {
        "key": "display_type",
        "label": "Display type",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "options": [
          "LCD",
          "OLED",
          "AMOLED",
          "Other"
        ],
        "filterable": true,
        "group": "Display"
      },
      {
        "key": "battery_mah",
        "label": "Battery capacity",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "mAh",
        "min": 100,
        "max": 30000,
        "filterable": true,
        "group": "Battery"
      },
      {
        "key": "network_generation",
        "label": "Network generation",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "2G",
          "3G",
          "4G",
          "5G"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Connectivity"
      },
      {
        "key": "sim_type",
        "label": "SIM configuration",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "options": [
          "single_sim",
          "dual_sim",
          "esim",
          "dual_sim_esim"
        ],
        "filterable": true,
        "group": "Connectivity"
      },
      {
        "key": "rear_camera_mp",
        "label": "Main rear camera",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "MP",
        "min": 0,
        "filterable": true,
        "group": "Camera"
      },
      {
        "key": "processor",
        "label": "Processor / SoC",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Performance"
      },
      {
        "key": "in_the_box",
        "label": "In the box",
        "type": "multi_select",
        "appliesTo": "master",
        "required": true,
        "group": "Package"
      },
      {
        "key": "sar_value",
        "label": "Declared SAR value",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Safety"
      }
    ],
    "compliance": [
      {
        "code": "BIS_CRS_MOBILE",
        "type": "certificate",
        "label": "BIS CRS registration for the applicable handset model",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "WPC_ETA_WIRELESS",
        "type": "license",
        "label": "WPC equipment type approval for de-licensed radio bands",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": false
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Producer EPR registration under applicable e-waste rules",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BATTERY_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Battery producer/importer EPR registration where applicable",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "TEC_MTCTE",
        "type": "certificate",
        "label": "TEC/MTCTE certification when the notified equipment scope applies",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      }
    ],
    "example": {
      "title": "Acme Nova 5G — 8 GB / 256 GB",
      "sku": "PHN-ACM-NOVA5G",
      "options": "ram=8 GB; storage=256 GB; color=Midnight Blue",
      "listing": "MRP ₹29,999, selling ₹27,499, cost ₹24,000, stock 15, max 2/order"
    },
    "notes": [
      "Use GTIN for the exact retail variant when issued; use MPN/model number for manufacturer identity.",
      "Do not merge region-specific models if their bands, charger, warranty or certifications differ."
    ]
  },
  {
    "id": "tablets",
    "group": "Electronics",
    "name": "Tablets & e-readers",
    "aliases": [
      "tablet",
      "ipad",
      "e reader"
    ],
    "kind": "physical",
    "summary": "Portable touch devices; connectivity, memory and storage are key variant dimensions.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "connectivity",
      "ram",
      "storage",
      "color"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "operating_system",
        "label": "Operating system",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Platform"
      },
      {
        "key": "display_size_in",
        "label": "Display size",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "in",
        "filterable": true,
        "group": "Display"
      },
      {
        "key": "ram_gb",
        "label": "RAM",
        "type": "number",
        "appliesTo": "variant",
        "required": false,
        "unit": "GB",
        "filterable": true,
        "group": "Performance"
      },
      {
        "key": "storage_gb",
        "label": "Storage",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "GB",
        "filterable": true,
        "facetable": true,
        "group": "Performance"
      },
      {
        "key": "connectivity",
        "label": "Connectivity",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "options": [
          "wifi",
          "wifi_cellular"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Connectivity"
      },
      {
        "key": "battery_mah",
        "label": "Battery capacity",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "mAh",
        "group": "Battery"
      }
    ],
    "compliance": [
      {
        "code": "BIS_CRS_TABLET",
        "type": "certificate",
        "label": "BIS CRS registration for the applicable model",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "WPC_ETA_WIRELESS",
        "type": "license",
        "label": "WPC equipment type approval for wireless functions",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "E-waste EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BATTERY_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Battery EPR registration where applicable",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme Tab Pro 11 — Wi-Fi, 256 GB",
      "sku": "TAB-ACM-PRO11",
      "options": "connectivity=Wi-Fi; storage=256 GB; color=Silver",
      "listing": "MRP ₹44,999, selling ₹41,999, stock 8"
    }
  },
  {
    "id": "laptops",
    "group": "Electronics",
    "name": "Laptops & notebooks",
    "aliases": [
      "laptop",
      "notebook",
      "ultrabook"
    ],
    "kind": "physical",
    "summary": "Portable computers; keep CPU/GPU platform on the master and sellable memory/storage/colour combinations as variants.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "ram",
      "storage",
      "color",
      "operating_system"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "processor",
        "label": "Processor",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Performance"
      },
      {
        "key": "ram_gb",
        "label": "RAM",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "GB",
        "filterable": true,
        "facetable": true,
        "group": "Performance"
      },
      {
        "key": "storage",
        "label": "Storage configuration",
        "type": "string",
        "appliesTo": "variant",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Performance"
      },
      {
        "key": "display_size_in",
        "label": "Display size",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "in",
        "filterable": true,
        "facetable": true,
        "group": "Display"
      },
      {
        "key": "display_resolution",
        "label": "Display resolution",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Display"
      },
      {
        "key": "graphics",
        "label": "Graphics processor",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "filterable": true,
        "group": "Performance"
      },
      {
        "key": "operating_system",
        "label": "Operating system",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Software"
      },
      {
        "key": "battery_wh",
        "label": "Battery capacity",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "Wh",
        "group": "Battery"
      }
    ],
    "compliance": [
      {
        "code": "BIS_CRS_LAPTOP",
        "type": "certificate",
        "label": "BIS CRS registration for the applicable model",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "WPC_ETA_WIRELESS",
        "type": "license",
        "label": "WPC approval for Wi-Fi/Bluetooth radio modules",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "E-waste EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BATTERY_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Battery EPR registration where applicable",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme Air 14 — Core Ultra 5",
      "sku": "LAP-ACM-AIR14",
      "options": "ram=16 GB; storage=512 GB SSD; color=Graphite",
      "listing": "MRP ₹84,990, selling ₹76,990, stock 6, lead time 1 day"
    }
  },
  {
    "id": "televisions-monitors",
    "group": "Electronics",
    "name": "Televisions & monitors",
    "aliases": [
      "tv",
      "television",
      "monitor",
      "display"
    ],
    "kind": "physical",
    "summary": "Large displays where panel, resolution, power and installation characteristics drive comparison.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "screen_size"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "screen_size_in",
        "label": "Screen size",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "in",
        "filterable": true,
        "facetable": true,
        "group": "Display"
      },
      {
        "key": "resolution",
        "label": "Resolution",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "HD",
          "Full HD",
          "QHD",
          "4K UHD",
          "8K"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Display"
      },
      {
        "key": "panel_type",
        "label": "Panel type",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Display"
      },
      {
        "key": "refresh_rate_hz",
        "label": "Refresh rate",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "Hz",
        "filterable": true,
        "group": "Display"
      },
      {
        "key": "smart_tv",
        "label": "Smart TV",
        "type": "boolean",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Platform"
      },
      {
        "key": "energy_rating",
        "label": "Energy rating",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Energy"
      }
    ],
    "compliance": [
      {
        "code": "BIS_CRS_DISPLAY",
        "type": "certificate",
        "label": "BIS CRS registration where the display category is notified",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "BEE_LABEL",
        "type": "standard",
        "label": "BEE star label where the product class is covered",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "WPC_ETA_WIRELESS",
        "type": "license",
        "label": "WPC approval when Wi-Fi/Bluetooth is included",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "E-waste EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme Vision 4K Smart TV",
      "sku": "TV-ACM-VISION4K",
      "options": "screen_size=55 inch",
      "listing": "MRP ₹59,990, selling ₹47,990, stock 4, lead time 2 days"
    }
  },
  {
    "id": "audio-wearables",
    "group": "Electronics",
    "name": "Audio, headphones & wearables",
    "aliases": [
      "headphones",
      "earbuds",
      "speaker",
      "smartwatch",
      "fitness band"
    ],
    "kind": "physical",
    "summary": "Wireless audio and wearable devices; battery, radio and fit variations need accurate declarations.",
    "unitPolicy": "Count; base unit piece or pair.",
    "variantAxes": [
      "color",
      "size"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "device_type",
        "label": "Device type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "earbuds",
          "headphones",
          "speaker",
          "smartwatch",
          "fitness_band"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Identity"
      },
      {
        "key": "connectivity",
        "label": "Connectivity",
        "type": "multi_select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "Bluetooth",
          "Wi-Fi",
          "USB",
          "3.5 mm"
        ],
        "filterable": true,
        "group": "Connectivity"
      },
      {
        "key": "battery_life_hours",
        "label": "Rated battery life",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "hours",
        "min": 0,
        "filterable": true,
        "group": "Battery"
      },
      {
        "key": "water_resistance",
        "label": "Water resistance rating",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Durability"
      },
      {
        "key": "size",
        "label": "Wearable size",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "filterable": true,
        "group": "Fit"
      }
    ],
    "compliance": [
      {
        "code": "BIS_CRS_ELECTRONICS",
        "type": "certificate",
        "label": "BIS registration where the notified product class applies",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "WPC_ETA_WIRELESS",
        "type": "license",
        "label": "WPC approval for Bluetooth/Wi-Fi equipment",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "E-waste EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BATTERY_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Battery EPR registration where applicable",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme Buds Pro ANC",
      "sku": "AUD-ACM-BUDSPRO",
      "options": "color=Black",
      "listing": "MRP ₹7,999, selling ₹6,499, stock 30"
    }
  },
  {
    "id": "cameras",
    "group": "Electronics",
    "name": "Cameras & imaging",
    "aliases": [
      "camera",
      "dslr",
      "mirrorless",
      "lens"
    ],
    "kind": "physical",
    "summary": "Camera bodies, lenses and imaging products. Keep mount and model compatibility searchable.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "kit",
      "color"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "camera_type",
        "label": "Camera type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "mirrorless",
          "dslr",
          "compact",
          "action",
          "instant",
          "security"
        ],
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "sensor",
        "label": "Sensor format",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "filterable": true,
        "group": "Imaging"
      },
      {
        "key": "resolution_mp",
        "label": "Resolution",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "MP",
        "filterable": true,
        "group": "Imaging"
      },
      {
        "key": "lens_mount",
        "label": "Lens mount",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "filterable": true,
        "group": "Compatibility"
      },
      {
        "key": "kit",
        "label": "Kit configuration",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "group": "Package"
      },
      {
        "key": "video_resolution",
        "label": "Maximum video resolution",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Imaging"
      }
    ],
    "compliance": [
      {
        "code": "BIS_CRS_CAMERA",
        "type": "certificate",
        "label": "BIS registration where the notified product class applies",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "WPC_ETA_WIRELESS",
        "type": "license",
        "label": "WPC approval when wireless radio is fitted",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "E-waste EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme M50 Mirrorless Camera",
      "sku": "CAM-ACM-M50",
      "options": "kit=Body + 18-55 mm",
      "listing": "MRP ₹74,999, selling ₹69,999, stock 3"
    }
  },
  {
    "id": "major-appliances",
    "group": "Home & appliances",
    "name": "Major home appliances",
    "aliases": [
      "refrigerator",
      "washing machine",
      "air conditioner",
      "microwave"
    ],
    "kind": "physical",
    "summary": "Large electrical appliances requiring capacity, installation, energy and warranty detail.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "capacity",
      "color"
    ],
    "attributes": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_name",
        "label": "Model name",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "model_year",
        "label": "Model year",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 2000,
        "max": 2100,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "warranty_months",
        "label": "Warranty",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "months",
        "min": 0,
        "max": 120,
        "filterable": true,
        "group": "Warranty"
      },
      {
        "key": "appliance_type",
        "label": "Appliance type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "facetable": true,
        "group": "Identity"
      },
      {
        "key": "capacity",
        "label": "Rated capacity",
        "type": "string",
        "appliesTo": "variant",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Performance"
      },
      {
        "key": "energy_rating",
        "label": "BEE energy rating",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Energy"
      },
      {
        "key": "annual_energy_kwh",
        "label": "Annual energy consumption",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "kWh",
        "min": 0,
        "group": "Energy"
      },
      {
        "key": "installation_required",
        "label": "Installation required",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "group": "Service"
      },
      {
        "key": "compressor_motor_warranty_years",
        "label": "Compressor / motor warranty",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "years",
        "min": 0,
        "group": "Warranty"
      }
    ],
    "compliance": [
      {
        "code": "BIS_APPLIANCE",
        "type": "certificate",
        "label": "BIS certification/registration for the applicable notified appliance",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "BEE_LABEL",
        "type": "standard",
        "label": "BEE star label for covered appliance classes",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_WASTE_EPR",
        "type": "regulatory_id",
        "label": "E-waste EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme FrostFree Refrigerator 340 L",
      "sku": "APP-ACM-RF340",
      "options": "capacity=340 L; color=Steel",
      "listing": "MRP ₹46,990, selling ₹41,490, stock 5, lead time 2 days"
    }
  },
  {
    "id": "furniture",
    "group": "Home & appliances",
    "name": "Furniture",
    "aliases": [
      "sofa",
      "bed",
      "table",
      "chair",
      "wardrobe"
    ],
    "kind": "physical",
    "summary": "Assembled or flat-pack furniture where exact dimensions, material and installation determine suitability.",
    "unitPolicy": "Count; base unit piece or set.",
    "variantAxes": [
      "size",
      "finish",
      "color"
    ],
    "attributes": [
      {
        "key": "furniture_type",
        "label": "Furniture type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Identity"
      },
      {
        "key": "primary_material",
        "label": "Primary material",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Material"
      },
      {
        "key": "finish",
        "label": "Finish",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "filterable": true,
        "group": "Appearance"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Appearance"
      },
      {
        "key": "width_cm",
        "label": "Width",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "cm",
        "min": 0,
        "group": "Dimensions"
      },
      {
        "key": "depth_cm",
        "label": "Depth",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "cm",
        "min": 0,
        "group": "Dimensions"
      },
      {
        "key": "height_cm",
        "label": "Height",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "cm",
        "min": 0,
        "group": "Dimensions"
      },
      {
        "key": "assembly_required",
        "label": "Assembly required",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "group": "Service"
      },
      {
        "key": "seating_capacity",
        "label": "Seating capacity",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 1,
        "filterable": true,
        "group": "Capacity"
      },
      {
        "key": "load_capacity_kg",
        "label": "Load capacity",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "kg",
        "min": 0,
        "group": "Safety"
      }
    ],
    "compliance": [
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations for pre-packed furniture",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "TIMBER_ORIGIN",
        "type": "certificate",
        "label": "Lawful timber origin / forest certification where claimed or required",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Solid Sheesham 4-Seater Dining Table",
      "sku": "FUR-DINE-SH4",
      "options": "finish=Walnut; size=4 seater",
      "listing": "MRP ₹32,000, selling ₹26,999, stock 2, lead time 7 days"
    }
  },
  {
    "id": "apparel",
    "group": "Fashion",
    "name": "Apparel",
    "aliases": [
      "clothing",
      "shirts",
      "dresses",
      "sarees",
      "trousers"
    ],
    "kind": "physical",
    "summary": "Garments where size and colour are variants and fibre, fit and care are master specifications.",
    "unitPolicy": "Count; base unit piece or set.",
    "variantAxes": [
      "size",
      "color"
    ],
    "attributes": [
      {
        "key": "gender",
        "label": "Department / gender",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "men",
          "women",
          "boys",
          "girls",
          "unisex"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Fit"
      },
      {
        "key": "size",
        "label": "Size",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Fit"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "searchable": true,
        "group": "Appearance"
      },
      {
        "key": "material",
        "label": "Material composition",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "searchable": true,
        "group": "Material"
      },
      {
        "key": "pattern",
        "label": "Pattern",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Appearance"
      },
      {
        "key": "care_instructions",
        "label": "Care instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Care"
      },
      {
        "key": "country_of_origin",
        "label": "Country of origin",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Origin"
      },
      {
        "key": "fit",
        "label": "Fit",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Fit"
      },
      {
        "key": "sleeve",
        "label": "Sleeve",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Style"
      },
      {
        "key": "occasion",
        "label": "Occasion",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Style"
      }
    ],
    "compliance": [
      {
        "code": "TEXTILE_FIBRE_LABEL",
        "type": "standard",
        "label": "Fibre composition, size, care and manufacturer/importer declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Women’s Cotton Relaxed Shirt",
      "sku": "APP-W-SHIRT-COT",
      "options": "size=M; color=Sky Blue",
      "listing": "MRP ₹1,499, selling ₹1,099, stock 18 per variant"
    }
  },
  {
    "id": "footwear",
    "group": "Fashion",
    "name": "Footwear",
    "aliases": [
      "shoes",
      "sandals",
      "slippers",
      "boots"
    ],
    "kind": "physical",
    "summary": "Footwear where size, width and colour identify sellable variants.",
    "unitPolicy": "Count; base unit pair.",
    "variantAxes": [
      "size",
      "width",
      "color"
    ],
    "attributes": [
      {
        "key": "department",
        "label": "Department / gender",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Fit"
      },
      {
        "key": "size_system",
        "label": "Size system",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "India/UK",
          "EU",
          "US"
        ],
        "group": "Fit"
      },
      {
        "key": "size",
        "label": "Size",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Fit"
      },
      {
        "key": "width",
        "label": "Width fit",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "options": [
          "narrow",
          "standard",
          "wide"
        ],
        "filterable": true,
        "group": "Fit"
      },
      {
        "key": "color",
        "label": "Colour",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Appearance"
      },
      {
        "key": "upper_material",
        "label": "Upper material",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Material"
      },
      {
        "key": "sole_material",
        "label": "Sole material",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Material"
      },
      {
        "key": "closure",
        "label": "Closure",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Design"
      },
      {
        "key": "care_instructions",
        "label": "Care instructions",
        "type": "text",
        "appliesTo": "master",
        "required": false,
        "group": "Care"
      }
    ],
    "compliance": [
      {
        "code": "FOOTWEAR_BIS",
        "type": "certificate",
        "label": "BIS quality-control certification for covered footwear products",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Men’s Everyday Running Shoes",
      "sku": "SHOE-M-RUN-EVERY",
      "options": "size=9 India/UK; color=Black; width=Standard",
      "listing": "MRP ₹3,499, selling ₹2,799, stock 11"
    }
  },
  {
    "id": "jewellery",
    "group": "Fashion",
    "name": "Jewellery & precious articles",
    "aliases": [
      "jewelry",
      "gold",
      "silver",
      "diamond"
    ],
    "kind": "physical",
    "summary": "Precious and fashion jewellery requiring material, purity, weight, stone and hallmark traceability.",
    "unitPolicy": "Count for articles; preserve exact net precious-metal weight as an attribute.",
    "variantAxes": [
      "size",
      "metal_color"
    ],
    "attributes": [
      {
        "key": "jewellery_type",
        "label": "Jewellery type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Identity"
      },
      {
        "key": "metal",
        "label": "Metal",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Material"
      },
      {
        "key": "purity",
        "label": "Purity / fineness",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "group": "Material"
      },
      {
        "key": "net_metal_weight_g",
        "label": "Net metal weight",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "g",
        "min": 0,
        "group": "Weight"
      },
      {
        "key": "gross_weight_g",
        "label": "Gross weight",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "g",
        "min": 0,
        "group": "Weight"
      },
      {
        "key": "size",
        "label": "Size",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "filterable": true,
        "group": "Fit"
      },
      {
        "key": "stone_details",
        "label": "Stone details",
        "type": "json",
        "appliesTo": "master",
        "required": false,
        "group": "Stones"
      },
      {
        "key": "hallmark_uid",
        "label": "HUID / hallmark identifier",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Compliance"
      }
    ],
    "compliance": [
      {
        "code": "BIS_HALLMARK",
        "type": "certificate",
        "label": "BIS hallmark/HUID record for articles within mandatory hallmarking scope",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology declarations and net quantity/weight",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "STONE_CERTIFICATE",
        "type": "certificate",
        "label": "Independent gemstone/diamond grading certificate when claimed",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "22K Gold Floral Ring",
      "sku": "JWL-RING-FLR-22K",
      "options": "size=14; metal_color=Yellow Gold",
      "listing": "Price maintained from approved valuation; stock 1; max 1/order"
    }
  },
  {
    "id": "beauty-cosmetics",
    "group": "Health & beauty",
    "name": "Beauty & cosmetics",
    "aliases": [
      "cosmetics",
      "skin care",
      "makeup",
      "hair care"
    ],
    "kind": "physical",
    "summary": "Cosmetic products where ingredients, batch, shelf life, responsible party and shade identity matter.",
    "unitPolicy": "Count, mass or volume according to the declared pack.",
    "variantAxes": [
      "shade",
      "size"
    ],
    "attributes": [
      {
        "key": "product_form",
        "label": "Product form",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "shade",
        "label": "Shade",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "searchable": true,
        "filterable": true,
        "facetable": true,
        "group": "Appearance"
      },
      {
        "key": "skin_hair_type",
        "label": "Suitable skin / hair type",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Suitability"
      },
      {
        "key": "net_quantity",
        "label": "Net quantity",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "min": 0.001,
        "group": "Pack"
      },
      {
        "key": "net_quantity_unit",
        "label": "Quantity unit",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "g",
          "kg",
          "ml",
          "l",
          "piece"
        ],
        "group": "Pack"
      },
      {
        "key": "ingredients",
        "label": "Ingredients / INCI",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Ingredients"
      },
      {
        "key": "usage_instructions",
        "label": "Directions for use",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Use"
      },
      {
        "key": "warnings",
        "label": "Warnings",
        "type": "text",
        "appliesTo": "master",
        "required": false,
        "group": "Safety"
      },
      {
        "key": "batch_number",
        "label": "Batch number",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      },
      {
        "key": "shelf_life_months",
        "label": "Shelf life",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "months",
        "min": 1,
        "group": "Storage"
      }
    ],
    "compliance": [
      {
        "code": "COSMETICS_LICENSE",
        "type": "license",
        "label": "Applicable cosmetic manufacturing/import registration or licence",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "COSMETICS_LABEL",
        "type": "standard",
        "label": "Cosmetics Rules labelling declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Long-Wear Matte Lip Colour",
      "sku": "BEAUTY-LIP-MATTE",
      "options": "shade=Rosewood; size=4.5 ml",
      "listing": "MRP ₹899, selling ₹749, stock 35; no unsubstantiated medical claims"
    }
  },
  {
    "id": "packaged-food",
    "group": "Grocery & food",
    "name": "Packaged food & beverages",
    "aliases": [
      "food",
      "snacks",
      "beverages",
      "grocery"
    ],
    "kind": "physical",
    "summary": "Pre-packed food where licence, ingredients, nutrition, allergens, lot and date declarations are mandatory.",
    "unitPolicy": "Mass, volume or count exactly matching the label.",
    "variantAxes": [
      "flavour",
      "pack_size"
    ],
    "attributes": [
      {
        "key": "net_quantity",
        "label": "Net quantity",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "min": 0.001,
        "group": "Pack"
      },
      {
        "key": "net_quantity_unit",
        "label": "Net quantity unit",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "g",
          "kg",
          "ml",
          "l",
          "piece"
        ],
        "group": "Pack"
      },
      {
        "key": "ingredients",
        "label": "Ingredients",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Food information"
      },
      {
        "key": "allergens",
        "label": "Allergen declaration",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "group": "Food information"
      },
      {
        "key": "dietary_mark",
        "label": "Dietary mark",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "vegetarian",
          "non_vegetarian",
          "vegan"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Food information"
      },
      {
        "key": "shelf_life_days",
        "label": "Shelf life",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "days",
        "min": 1,
        "group": "Storage"
      },
      {
        "key": "storage_instructions",
        "label": "Storage instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Storage"
      },
      {
        "key": "manufacturer_name",
        "label": "Manufacturer / packer",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      },
      {
        "key": "flavour",
        "label": "Flavour",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Taste"
      },
      {
        "key": "nutrition_per_100",
        "label": "Nutrition per 100 g/ml",
        "type": "json",
        "appliesTo": "master",
        "required": true,
        "group": "Nutrition"
      },
      {
        "key": "fssai_license_number",
        "label": "FSSAI licence number",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      },
      {
        "key": "batch_or_lot",
        "label": "Batch / lot",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      }
    ],
    "compliance": [
      {
        "code": "FSSAI_LICENSE",
        "type": "license",
        "label": "Valid FSSAI licence/registration for the responsible food business",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "FSSAI_LABEL",
        "type": "standard",
        "label": "Food Safety and Standards labelling and display declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Roasted Almonds — Lightly Salted",
      "sku": "FOOD-ALM-RST",
      "options": "flavour=Lightly Salted; pack_size=250 g",
      "listing": "MRP ₹499, selling ₹449, stock 80, FIFO by batch"
    }
  },
  {
    "id": "fresh-produce",
    "group": "Grocery & food",
    "name": "Fresh produce",
    "aliases": [
      "fruits",
      "vegetables",
      "fresh food"
    ],
    "kind": "physical",
    "summary": "Variable-weight fresh fruits and vegetables requiring grade, origin and unit clarity.",
    "unitPolicy": "Mass or count. Enable fractional quantities only when fulfilment and weighing support them.",
    "variantAxes": [
      "grade",
      "pack_size"
    ],
    "attributes": [
      {
        "key": "produce_type",
        "label": "Produce type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "fruit",
          "vegetable",
          "herb"
        ],
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "variety",
        "label": "Variety",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "grade",
        "label": "Grade",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "options": [
          "standard",
          "premium",
          "organic"
        ],
        "filterable": true,
        "group": "Quality"
      },
      {
        "key": "country_or_region",
        "label": "Country / region of origin",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Origin"
      },
      {
        "key": "organic_certified",
        "label": "Certified organic",
        "type": "boolean",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Claims"
      },
      {
        "key": "storage_instructions",
        "label": "Storage instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Storage"
      }
    ],
    "compliance": [
      {
        "code": "FSSAI_LICENSE",
        "type": "license",
        "label": "FSSAI licence/registration for the applicable food business",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "ORGANIC_CERTIFICATION",
        "type": "certificate",
        "label": "NPOP/PGS or other accepted certification when sold as certified organic",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Packaged-commodity declarations for pre-packed produce",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Premium Kinnaur Apples",
      "sku": "PROD-APPLE-KIN",
      "options": "grade=Premium; pack_size=1 kg",
      "listing": "Selling ₹249 per 1 kg; stock represented in whole sellable packs"
    }
  },
  {
    "id": "supplements",
    "group": "Health & beauty",
    "name": "Health supplements & nutraceuticals",
    "aliases": [
      "supplement",
      "protein",
      "vitamins",
      "nutraceutical"
    ],
    "kind": "physical",
    "summary": "Foods/supplements with dosage, ingredient and claims controls; never represent them as medicines without approval.",
    "unitPolicy": "Count, mass or volume matching the pack.",
    "variantAxes": [
      "flavour",
      "pack_size"
    ],
    "attributes": [
      {
        "key": "net_quantity",
        "label": "Net quantity",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "min": 0.001,
        "group": "Pack"
      },
      {
        "key": "net_quantity_unit",
        "label": "Net quantity unit",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "g",
          "kg",
          "ml",
          "l",
          "piece"
        ],
        "group": "Pack"
      },
      {
        "key": "ingredients",
        "label": "Ingredients",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Food information"
      },
      {
        "key": "allergens",
        "label": "Allergen declaration",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "group": "Food information"
      },
      {
        "key": "dietary_mark",
        "label": "Dietary mark",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "vegetarian",
          "non_vegetarian",
          "vegan"
        ],
        "filterable": true,
        "facetable": true,
        "group": "Food information"
      },
      {
        "key": "shelf_life_days",
        "label": "Shelf life",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "days",
        "min": 1,
        "group": "Storage"
      },
      {
        "key": "storage_instructions",
        "label": "Storage instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Storage"
      },
      {
        "key": "manufacturer_name",
        "label": "Manufacturer / packer",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Traceability"
      },
      {
        "key": "serving_size",
        "label": "Serving size",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "group": "Directions"
      },
      {
        "key": "servings_per_pack",
        "label": "Servings per pack",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 1,
        "group": "Pack"
      },
      {
        "key": "active_ingredients",
        "label": "Active ingredients per serving",
        "type": "json",
        "appliesTo": "master",
        "required": true,
        "group": "Composition"
      },
      {
        "key": "recommended_usage",
        "label": "Recommended usage",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Directions"
      },
      {
        "key": "warnings",
        "label": "Warnings / contraindications",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Safety"
      }
    ],
    "compliance": [
      {
        "code": "FSSAI_NUTRACEUTICAL_LICENSE",
        "type": "license",
        "label": "FSSAI licence covering the supplement/nutraceutical activity",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "FSSAI_NUTRACEUTICAL_LABEL",
        "type": "standard",
        "label": "Applicable nutraceutical composition, warning and claims declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "SPORT_CERTIFICATION",
        "type": "certificate",
        "label": "Batch sport/banned-substance certification when claimed",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      }
    ],
    "example": {
      "title": "Whey Protein Concentrate — Chocolate",
      "sku": "SUP-WHEY-CHOC",
      "options": "flavour=Chocolate; pack_size=1 kg",
      "listing": "MRP ₹3,499, selling ₹3,099, stock 22; claims must match approved label"
    }
  },
  {
    "id": "books",
    "group": "Media & education",
    "name": "Books & publications",
    "aliases": [
      "book",
      "textbook",
      "magazine"
    ],
    "kind": "physical",
    "summary": "Print publications identified by edition, language, format and ISBN.",
    "unitPolicy": "Count; base unit copy.",
    "variantAxes": [
      "format",
      "language"
    ],
    "attributes": [
      {
        "key": "author",
        "label": "Author / contributor",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Bibliographic"
      },
      {
        "key": "publisher",
        "label": "Publisher",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Bibliographic"
      },
      {
        "key": "isbn13",
        "label": "ISBN-13",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "regex": "^[0-9]{13}$",
        "searchable": true,
        "group": "Identifiers"
      },
      {
        "key": "language",
        "label": "Language",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "searchable": true,
        "filterable": true,
        "facetable": true,
        "group": "Edition"
      },
      {
        "key": "format",
        "label": "Format",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "options": [
          "paperback",
          "hardcover",
          "board_book",
          "spiral"
        ],
        "filterable": true,
        "group": "Edition"
      },
      {
        "key": "edition",
        "label": "Edition",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "group": "Edition"
      },
      {
        "key": "publication_date",
        "label": "Publication date",
        "type": "date",
        "appliesTo": "master",
        "required": false,
        "group": "Bibliographic"
      },
      {
        "key": "page_count",
        "label": "Page count",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 1,
        "group": "Physical"
      },
      {
        "key": "subject",
        "label": "Subject / genre",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "filterable": true,
        "group": "Discovery"
      }
    ],
    "compliance": [
      {
        "code": "ISBN_ASSIGNMENT",
        "type": "regulatory_id",
        "label": "Valid ISBN assignment when represented as an ISBN publication",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Applicable retail declarations",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Principles of Modern Horticulture, 3rd Edition",
      "sku": "BOOK-HORT-3E",
      "options": "format=Paperback; language=English",
      "listing": "MRP ₹799, selling ₹679, stock 40"
    }
  },
  {
    "id": "toys",
    "group": "Kids & toys",
    "name": "Toys & games",
    "aliases": [
      "toy",
      "game",
      "puzzle"
    ],
    "kind": "physical",
    "summary": "Products intended for play; age grading, materials, warnings and conformity are safety-critical.",
    "unitPolicy": "Count; base unit piece or set.",
    "variantAxes": [
      "color",
      "pack_size"
    ],
    "attributes": [
      {
        "key": "toy_type",
        "label": "Toy type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Identity"
      },
      {
        "key": "minimum_age_years",
        "label": "Minimum age",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "years",
        "min": 0,
        "max": 18,
        "filterable": true,
        "group": "Age"
      },
      {
        "key": "maximum_age_years",
        "label": "Maximum age",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "unit": "years",
        "min": 0,
        "max": 18,
        "group": "Age"
      },
      {
        "key": "materials",
        "label": "Materials",
        "type": "multi_select",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Safety"
      },
      {
        "key": "battery_required",
        "label": "Battery required",
        "type": "boolean",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Power"
      },
      {
        "key": "battery_included",
        "label": "Battery included",
        "type": "boolean",
        "appliesTo": "master",
        "required": false,
        "group": "Power"
      },
      {
        "key": "small_parts_warning",
        "label": "Small-parts warning",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "group": "Safety"
      },
      {
        "key": "safety_warnings",
        "label": "Safety warnings",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Safety"
      }
    ],
    "compliance": [
      {
        "code": "BIS_TOY",
        "type": "certificate",
        "label": "BIS licence/conformity for toys under the applicable Quality Control Order",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "TOY_SAFETY_LABEL",
        "type": "standard",
        "label": "Age grading, warnings and traceability labelling",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BATTERY_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Battery EPR registration where batteries are supplied",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Wooden Shape Sorting Puzzle — 18 Months+",
      "sku": "TOY-SHAPE-WOOD",
      "options": "color=Multicolour",
      "listing": "MRP ₹799, selling ₹649, stock 25"
    }
  },
  {
    "id": "automotive-parts",
    "group": "Automotive",
    "name": "Automotive parts & accessories",
    "aliases": [
      "car parts",
      "bike parts",
      "tyres",
      "helmet"
    ],
    "kind": "physical",
    "summary": "Vehicle-specific parts where compatibility, homologation and safety certification must be explicit.",
    "unitPolicy": "Count; base unit piece, pair or set.",
    "variantAxes": [
      "vehicle_fitment",
      "size"
    ],
    "attributes": [
      {
        "key": "part_type",
        "label": "Part type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "manufacturer_part_number",
        "label": "Manufacturer part number",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identifiers"
      },
      {
        "key": "vehicle_make",
        "label": "Compatible vehicle make",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "filterable": true,
        "group": "Compatibility"
      },
      {
        "key": "vehicle_model",
        "label": "Compatible vehicle model",
        "type": "multi_select",
        "appliesTo": "variant",
        "required": false,
        "searchable": true,
        "filterable": true,
        "group": "Compatibility"
      },
      {
        "key": "model_year_range",
        "label": "Compatible model years",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Compatibility"
      },
      {
        "key": "position",
        "label": "Fitment position",
        "type": "select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Compatibility"
      },
      {
        "key": "material",
        "label": "Material",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Construction"
      },
      {
        "key": "installation_notes",
        "label": "Installation notes",
        "type": "text",
        "appliesTo": "master",
        "required": false,
        "group": "Installation"
      }
    ],
    "compliance": [
      {
        "code": "AIS_BIS_COMPONENT",
        "type": "certificate",
        "label": "Applicable AIS/BIS/type-approval certification for regulated components",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "E_MARK_OR_HOMOLOGATION",
        "type": "certificate",
        "label": "Homologation evidence where represented or required",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      }
    ],
    "example": {
      "title": "Front Brake Pad Set for Acme Hatchback 2021–2025",
      "sku": "AUTO-BPAD-ACM-H21",
      "options": "vehicle_fitment=2021–2025; position=Front",
      "listing": "MRP ₹2,499, selling ₹2,149, stock 9"
    }
  },
  {
    "id": "batteries",
    "group": "Automotive",
    "name": "Batteries & power storage",
    "aliases": [
      "battery",
      "inverter battery",
      "power bank"
    ],
    "kind": "physical",
    "summary": "Portable, automotive and stationary batteries with chemistry, rating, hazard and take-back duties.",
    "unitPolicy": "Count; base unit piece.",
    "variantAxes": [
      "capacity",
      "terminal_layout"
    ],
    "attributes": [
      {
        "key": "battery_type",
        "label": "Battery type",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "group": "Identity"
      },
      {
        "key": "chemistry",
        "label": "Chemistry",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "group": "Safety"
      },
      {
        "key": "voltage_v",
        "label": "Nominal voltage",
        "type": "number",
        "appliesTo": "master",
        "required": true,
        "unit": "V",
        "min": 0,
        "filterable": true,
        "group": "Electrical"
      },
      {
        "key": "capacity",
        "label": "Rated capacity",
        "type": "string",
        "appliesTo": "variant",
        "required": true,
        "searchable": true,
        "filterable": true,
        "group": "Electrical"
      },
      {
        "key": "rechargeable",
        "label": "Rechargeable",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "group": "Electrical"
      },
      {
        "key": "hazard_class",
        "label": "Transport hazard classification",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Safety"
      },
      {
        "key": "compatible_models",
        "label": "Compatible models",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "group": "Compatibility"
      }
    ],
    "compliance": [
      {
        "code": "BATTERY_WASTE_EPR",
        "type": "regulatory_id",
        "label": "Battery producer/importer EPR registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BIS_BATTERY",
        "type": "certificate",
        "label": "BIS certification for the applicable battery/product class",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "UN38_3",
        "type": "certificate",
        "label": "UN 38.3 transport test evidence for applicable lithium batteries",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "12 V 45 Ah Automotive Battery",
      "sku": "BAT-AUTO-12V45",
      "options": "capacity=45 Ah; terminal_layout=Left Positive",
      "listing": "MRP ₹5,999, selling ₹5,299, stock 7; hazardous shipping profile on"
    }
  },
  {
    "id": "medical-devices",
    "group": "Health & beauty",
    "name": "Medical devices",
    "aliases": [
      "medical device",
      "diagnostic",
      "thermometer",
      "oximeter"
    ],
    "kind": "physical",
    "summary": "Regulated devices requiring intended use, risk class, licence, lot/serial and customer-safe claims.",
    "unitPolicy": "Count; base unit piece or kit.",
    "variantAxes": [
      "size",
      "configuration"
    ],
    "attributes": [
      {
        "key": "intended_use",
        "label": "Intended use",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Regulatory"
      },
      {
        "key": "device_class",
        "label": "Medical device class",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "A",
          "B",
          "C",
          "D"
        ],
        "filterable": true,
        "group": "Regulatory"
      },
      {
        "key": "model_number",
        "label": "Model number",
        "type": "string",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Identity"
      },
      {
        "key": "sterile",
        "label": "Sterile",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "filterable": true,
        "group": "Safety"
      },
      {
        "key": "single_use",
        "label": "Single use",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "group": "Safety"
      },
      {
        "key": "measurement_range",
        "label": "Measurement range",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Performance"
      },
      {
        "key": "accuracy",
        "label": "Declared accuracy",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "group": "Performance"
      },
      {
        "key": "warnings",
        "label": "Warnings / contraindications",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Safety"
      },
      {
        "key": "udi_or_device_id",
        "label": "UDI / device identifier",
        "type": "string",
        "appliesTo": "master",
        "required": false,
        "searchable": true,
        "group": "Traceability"
      }
    ],
    "compliance": [
      {
        "code": "CDSCO_MEDICAL_DEVICE",
        "type": "license",
        "label": "Applicable CDSCO manufacturing/import licence or registration",
        "required": true,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "MEDICAL_DEVICE_LABEL",
        "type": "standard",
        "label": "Medical Devices Rules labelling and traceability declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BIS_MEDICAL_DEVICE",
        "type": "certificate",
        "label": "BIS conformity where the device class is covered",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "LEGAL_METROLOGY_PACK",
        "type": "standard",
        "label": "Legal Metrology packaged-commodity declarations",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Digital Pulse Oximeter — Model PX2",
      "sku": "MED-OXI-PX2",
      "options": "configuration=Device + Case",
      "listing": "MRP ₹2,499, selling ₹1,999, stock 20; claims exactly match licence"
    }
  },
  {
    "id": "digital-products",
    "group": "Digital & services",
    "name": "Digital products & licences",
    "aliases": [
      "software",
      "ebook",
      "digital download",
      "license key"
    ],
    "kind": "digital",
    "summary": "Non-physical entitlements delivered by download, key or account activation.",
    "unitPolicy": "Count; base unit licence, download or entitlement.",
    "variantAxes": [
      "platform",
      "term",
      "seat_count"
    ],
    "attributes": [
      {
        "key": "delivery_method",
        "label": "Delivery method",
        "type": "select",
        "appliesTo": "master",
        "required": true,
        "options": [
          "download",
          "license_key",
          "account_activation",
          "email"
        ],
        "filterable": true,
        "group": "Delivery"
      },
      {
        "key": "platform",
        "label": "Platform",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "filterable": true,
        "facetable": true,
        "group": "Compatibility"
      },
      {
        "key": "license_term",
        "label": "Licence term",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "options": [
          "one_time",
          "monthly",
          "annual",
          "multi_year"
        ],
        "filterable": true,
        "group": "Licence"
      },
      {
        "key": "seat_count",
        "label": "Seats / users",
        "type": "number",
        "appliesTo": "variant",
        "required": false,
        "min": 1,
        "filterable": true,
        "group": "Licence"
      },
      {
        "key": "system_requirements",
        "label": "System requirements",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Compatibility"
      },
      {
        "key": "region_restrictions",
        "label": "Region restrictions",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "group": "Licence"
      },
      {
        "key": "activation_instructions",
        "label": "Activation instructions",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Delivery"
      }
    ],
    "compliance": [
      {
        "code": "IP_DISTRIBUTION_RIGHTS",
        "type": "license",
        "label": "Documented distribution/licensing rights",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "DIGITAL_TERMS",
        "type": "standard",
        "label": "Customer licence, cancellation and refund terms",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "GST_DIGITAL_CLASSIFICATION",
        "type": "regulatory_id",
        "label": "Correct tax/service classification",
        "required": false,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Acme Design Suite — 1 Year",
      "sku": "DIG-ACM-DESIGN",
      "options": "platform=Windows; term=Annual; seat_count=1",
      "listing": "₹4,999 per licence; requiresShipping off; stock may represent key pool"
    }
  },
  {
    "id": "services",
    "group": "Digital & services",
    "name": "Services & appointments",
    "aliases": [
      "service",
      "appointment",
      "installation",
      "consultation"
    ],
    "kind": "service",
    "summary": "Time- or outcome-based services requiring scope, duration, location, lead time and cancellation terms.",
    "unitPolicy": "Time or count. Use hour/session/visit as the base unit.",
    "variantAxes": [
      "duration",
      "service_mode"
    ],
    "attributes": [
      {
        "key": "service_scope",
        "label": "Scope of service",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "searchable": true,
        "group": "Service"
      },
      {
        "key": "service_mode",
        "label": "Service mode",
        "type": "select",
        "appliesTo": "variant",
        "required": true,
        "options": [
          "at_customer",
          "at_provider",
          "remote"
        ],
        "filterable": true,
        "group": "Delivery"
      },
      {
        "key": "duration_minutes",
        "label": "Duration",
        "type": "number",
        "appliesTo": "variant",
        "required": true,
        "unit": "minutes",
        "min": 1,
        "group": "Scheduling"
      },
      {
        "key": "service_area",
        "label": "Service area",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "group": "Delivery"
      },
      {
        "key": "included_items",
        "label": "Included",
        "type": "multi_select",
        "appliesTo": "master",
        "required": true,
        "group": "Scope"
      },
      {
        "key": "excluded_items",
        "label": "Not included",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "group": "Scope"
      },
      {
        "key": "customer_preparation",
        "label": "Customer preparation",
        "type": "text",
        "appliesTo": "master",
        "required": false,
        "group": "Instructions"
      },
      {
        "key": "cancellation_terms",
        "label": "Cancellation / reschedule terms",
        "type": "text",
        "appliesTo": "master",
        "required": true,
        "group": "Terms"
      }
    ],
    "compliance": [
      {
        "code": "PROFESSIONAL_LICENSE",
        "type": "license",
        "label": "Professional/trade licence where the service is regulated",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      },
      {
        "code": "SERVICE_TERMS",
        "type": "standard",
        "label": "Published scope, cancellation, safety and liability terms",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      }
    ],
    "example": {
      "title": "Air Conditioner Standard Installation",
      "sku": "SVC-AC-INSTALL",
      "options": "service_mode=At Customer; duration=120 minutes",
      "listing": "Selling ₹1,499 per visit, stock represents bookable capacity, lead time 2 days"
    }
  },
  {
    "id": "gift-hampers",
    "group": "Bundles",
    "name": "Gift hampers & configurable bundles",
    "aliases": [
      "hamper",
      "gift box",
      "bundle",
      "combo"
    ],
    "kind": "bundle",
    "summary": "Fixed or configurable sets. Model every component, required/default choice and adjustment rather than hiding composition in copy.",
    "unitPolicy": "Count; base unit hamper/set.",
    "variantAxes": [
      "size",
      "theme"
    ],
    "attributes": [
      {
        "key": "occasion",
        "label": "Occasion",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "facetable": true,
        "group": "Use"
      },
      {
        "key": "theme",
        "label": "Theme",
        "type": "select",
        "appliesTo": "variant",
        "required": false,
        "filterable": true,
        "group": "Design"
      },
      {
        "key": "recipient",
        "label": "Recipient",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Use"
      },
      {
        "key": "item_count",
        "label": "Approximate item count",
        "type": "number",
        "appliesTo": "master",
        "required": false,
        "min": 1,
        "group": "Composition"
      },
      {
        "key": "contains_perishable_items",
        "label": "Contains perishables",
        "type": "boolean",
        "appliesTo": "master",
        "required": true,
        "group": "Fulfilment"
      },
      {
        "key": "allergens",
        "label": "Bundle allergen summary",
        "type": "multi_select",
        "appliesTo": "master",
        "required": false,
        "group": "Safety"
      },
      {
        "key": "personalisation_available",
        "label": "Personalisation available",
        "type": "boolean",
        "appliesTo": "master",
        "required": false,
        "filterable": true,
        "group": "Options"
      }
    ],
    "compliance": [
      {
        "code": "COMPONENT_COMPLIANCE",
        "type": "standard",
        "label": "Every regulated component retains its own valid compliance evidence",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "BUNDLE_LABEL",
        "type": "standard",
        "label": "Outer-pack quantity, MRP, responsible party and component declarations",
        "required": true,
        "jurisdictions": [
          "IN"
        ]
      },
      {
        "code": "FSSAI_LICENSE",
        "type": "license",
        "label": "FSSAI licence when the hamper contains food and the activity requires it",
        "required": false,
        "jurisdictions": [
          "IN"
        ],
        "requiresExpiry": true
      }
    ],
    "example": {
      "title": "Festive Flowers & Gourmet Hamper",
      "sku": "BND-FESTIVE-GOURMET",
      "options": "size=Grand; theme=Gold",
      "listing": "MRP ₹3,499, selling ₹3,199; component inventory and substitutions validated"
    }
  }
];
