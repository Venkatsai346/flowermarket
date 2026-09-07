/**
 * Chrome i18n — Telugu / English.
 *
 * Catalogue titles stay merchant-authored. Only shell copy (search, cart,
 * pin, arrival, footer, auth chrome) is translated so a Hyderabad/Kakinada
 * customer can use the shop in తెలుగు without a catalogue rewrite.
 */
export const STRINGS = {
  en: {
    searchPlaceholder: 'Search flowers, plants, gifts…',
    cart: 'Cart',
    setPin: 'Set pin',
    deliveringTo: 'Delivering to',
    dontDeliver: "We don't deliver to",
    setPinForSlots: 'Set your pincode for a delivery window',
    checkingSlot: 'Checking the next slot…',
    arrivesPrefix: 'Arrives',
    today: 'today',
    tomorrow: 'tomorrow',
    addToBasket: 'Add to basket',
    outOfStock: 'Out of stock',
    inYourBasket: 'In your basket',
    gstin: 'GSTIN',
    pricesInclusive: 'Prices inclusive of GST where applicable.',
    recentlyViewed: 'Recently viewed',
    completeTheGift: 'Complete the gift',
    youMayAlsoLike: 'You may also like',
    care: 'Care',
    backToShop: 'Back to shop',
    myOrders: 'My orders',
    signIn: 'Sign in',
    languageEn: 'EN',
    languageTe: 'తె',
  },
  te: {
    searchPlaceholder: 'పూలు, మొక్కలు, బహుమతులు…',
    cart: 'బాస్కెట్',
    setPin: 'పిన్ సెట్ చేయండి',
    deliveringTo: 'డెలివరీ',
    dontDeliver: 'మేము ఈ పిన్‌కు చేరవేత లేము',
    setPinForSlots: 'స్లాట్ కోసం మీ పిన్‌కోడ్ ఇవ్వండి',
    checkingSlot: 'తర్వాతి స్లాట్ చూస్తున్నాం…',
    arrivesPrefix: 'చేరుతుంది',
    today: 'ఈరోజు',
    tomorrow: 'రేపు',
    addToBasket: 'బాస్కెట్‌లో చేర్చండి',
    outOfStock: 'స్టాక్ లేదు',
    inYourBasket: 'మీ బాస్కెట్‌లో',
    gstin: 'GSTIN',
    pricesInclusive: 'వర్తించే చోట GST ధరలో ఉంది.',
    recentlyViewed: 'ఇటీవల చూసినవి',
    completeTheGift: 'బహుమతిని పూర్తి చేయండి',
    youMayAlsoLike: 'మీకు నచ్చవచ్చు',
    care: 'సంరక్షణ',
    backToShop: 'షాప్‌కు తిరిగి',
    myOrders: 'నా ఆర్డర్లు',
    signIn: 'సైన్ ఇన్',
    languageEn: 'EN',
    languageTe: 'తె',
  },
};

export function t(lang, key) {
  const pack = STRINGS[lang] || STRINGS.en;
  return pack[key] || STRINGS.en[key] || key;
}

export default t;
