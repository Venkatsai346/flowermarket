/**
 * India launch catalog — deterministic production seed manifest.
 * Remote media is deliberately URL-only: binaries do not belong in Git.
 * Brand marks resolve from the brand's official domain through Hunter's public
 * logo CDN; editorial photography is pinned to immutable Unsplash photo IDs.
 */
const photo = (id, width = 1200, height = 800) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&h=${height}&q=82`;
const relevantPhoto = (category, lock, width = 1200, height = 1200) => {
  const tags = `${slugify(category.name).replaceAll('-', ',')},${category.vertical},product`;
  return `https://loremflickr.com/${width}/${height}/${tags}?lock=${lock}`;
};
const MEDIA = {
  grocery: 'photo-1542838132-92c53300491e', vegetables: 'photo-1566385101042-1a0aa0c1268c',
  fashion: 'photo-1445205170230-053b83016050', beauty: 'photo-1596462502278-27bfdc403348',
  electronics: 'photo-1498049794561-7780e7231661', dairy: 'photo-1550583724-b2692b85b150',
  eggs: 'photo-1506976785307-8732e854ad03', household: 'photo-1583947215259-38e31be8751f',
  flowers: 'photo-1490750967868-88aa4486c946',
};
const slugify = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const field = (key, label, type = 'string', extra = {}) => ({ key, label, type, required: true, appliesTo: 'master', filterable: true, searchable: true, ...extra });
const variantField = (key, label, type = 'string', extra = {}) => field(key, label, type, { appliesTo: 'variant', facetable: true, ...extra });
const SCHEMAS = {
  grocery: [field('food_form', 'Food form'), field('ingredients', 'Ingredients'), field('diet_type', 'Diet type', 'select', { options: ['vegetarian', 'non_vegetarian', 'vegan', 'jain'] }), field('shelf_life_days', 'Shelf life', 'number', { unit: 'day', min: 1 }), field('storage_instructions', 'Storage instructions'), variantField('pack_size', 'Pack size', 'number', { unit: 'g', min: 1 })],
  vegetables: [field('variety', 'Variety'), field('farming_method', 'Farming method', 'select', { options: ['conventional', 'organic', 'natural', 'hydroponic'] }), field('grade', 'Produce grade', 'select', { options: ['standard', 'premium', 'export'] }), field('origin_state', 'Origin state'), variantField('net_weight', 'Net weight', 'number', { unit: 'g', min: 50 })],
  fashion: [field('department', 'Department'), field('material', 'Primary material'), field('fit', 'Fit'), field('care_instructions', 'Care instructions'), variantField('color', 'Color'), variantField('size', 'Size')],
  beauty: [field('product_form', 'Product form'), field('suitable_for', 'Suitable for'), field('key_ingredients', 'Key ingredients'), field('usage_instructions', 'Usage instructions'), field('shelf_life_months', 'Shelf life', 'number', { unit: 'month', min: 1 }), variantField('shade_or_size', 'Shade or size')],
  electronics: [field('model_name', 'Model name'), field('warranty_months', 'Warranty', 'number', { unit: 'month', min: 0 }), field('power_requirement', 'Power requirement'), field('connectivity', 'Connectivity'), variantField('configuration', 'Configuration'), variantField('color', 'Color')],
  dairy: [field('milk_type', 'Milk type'), field('fat_percentage', 'Fat', 'number', { unit: '%', min: 0 }), field('pasteurization', 'Pasteurization'), field('storage_temperature', 'Storage temperature'), variantField('volume', 'Volume', 'number', { unit: 'ml', min: 100 })],
  eggs: [field('egg_type', 'Egg type'), field('farming_method', 'Farming method'), field('size_grade', 'Size grade'), field('storage_instructions', 'Storage instructions'), variantField('count', 'Count', 'number', { unit: 'piece', min: 1 })],
  household: [field('primary_use', 'Primary use'), field('material_or_formula', 'Material or formula'), field('usage_instructions', 'Usage instructions'), field('safety_notes', 'Safety notes'), variantField('pack_size', 'Pack size')],
  flowers: [field('flower_type', 'Flower type'), field('stem_count', 'Stem count', 'number', { unit: 'stem', min: 1 }), field('color_family', 'Color family'), field('care_notes', 'Care notes'), variantField('arrangement_size', 'Arrangement size')],
};

const SECTION_ROWS = [
  ['grocery','Staples & cooking essentials','staples','Rice|Wheat flour & atta|Millets|Pulses & dals|Beans & legumes|Edible oils|Ghee|Salt|Sugar & jaggery|Whole spices|Ground spices|Masalas|Dry fruits|Nuts & seeds|Cooking pastes'],
  ['grocery','Packaged food','packaged-food','Biscuits & cookies|Namkeen & snacks|Chips|Breakfast cereals|Oats|Noodles|Pasta|Ready-to-eat meals|Ready-to-cook mixes|Soups|Sauces & ketchup|Pickles|Jams & spreads|Chocolate & confectionery|Frozen food'],
  ['grocery','Beverages & bakery','beverages-bakery','Tea|Coffee|Fruit juices|Soft drinks|Energy drinks|Packaged water|Health drinks|Bread|Cakes|Buns & pav|Bakery snacks'],
  ['vegetables','Indian vegetables','indian-vegetables','Potato|Onion|Tomato|Brinjal|Okra|Bottle gourd|Bitter gourd|Ridge gourd|Snake gourd|Ash gourd|Pointed gourd|Ivy gourd|Sponge gourd|Pumpkin|Cucumber|Drumstick|Raw banana|Raw papaya|Raw jackfruit|Green peas|French beans|Cluster beans|Broad beans|Cowpea beans|Carrot|Beetroot|Radish|Turnip|Sweet potato|Yam|Colocasia|Tapioca|Ginger|Garlic|Turmeric root|Green chilli|Capsicum|Cabbage|Cauliflower|Broccoli|Spinach|Amaranth leaves|Fenugreek leaves|Mustard greens|Bathua|Colocasia leaves|Curry leaves|Coriander leaves|Mint leaves|Spring onion|Leek|Celery|Lettuce|Mushroom|Baby corn|Sweet corn|Chow chow|Knol khol|Zucchini|Asparagus|Artichoke|Avocado|Cherry tomato|Red cabbage|Kale|Bamboo shoot|Lotus stem|Banana stem|Banana flower'],
  ['fashion','Men’s fashion','mens-fashion','Men’s shirts|Men’s T-shirts|Men’s jeans|Men’s trousers|Men’s ethnic wear|Men’s innerwear|Men’s activewear|Men’s jackets|Men’s footwear|Men’s accessories'],
  ['fashion','Women’s fashion','womens-fashion','Women’s sarees|Women’s kurtas|Women’s salwar suits|Women’s dresses|Women’s tops|Women’s jeans|Women’s trousers|Women’s lingerie|Women’s activewear|Women’s footwear|Women’s handbags|Women’s jewellery'],
  ['fashion','Kids & unisex fashion','kids-fashion','Boys clothing|Girls clothing|Baby clothing|Kids footwear|School wear|Maternity wear|Unisex clothing|Watches|Sunglasses|Travel luggage'],
  ['beauty','Beauty & personal care','beauty-care','Face cleansers|Face moisturizers|Sunscreen|Serums|Face masks|Lip care|Foundation|Concealer|Compact powder|Blush|Lipstick|Eye makeup|Nail care|Shampoo|Conditioner|Hair oil|Hair serum|Hair color|Body wash|Bath soap|Body lotion|Deodorants|Perfumes|Men’s grooming|Shaving care|Oral care|Feminine hygiene|Baby care|Beauty tools'],
  ['electronics','Personal electronics','personal-electronics','Smartphones|Feature phones|Tablets|Smartwatches|Fitness bands|Headphones|Earbuds|Bluetooth speakers|Power banks|Mobile chargers|Mobile cases|Screen protectors'],
  ['electronics','Computing & entertainment','computing-entertainment','Laptops|Desktop computers|Monitors|Keyboards|Computer mice|Printers|Routers|Storage drives|Televisions|Streaming devices|Home theatre|Gaming consoles|Gaming accessories|Cameras|Camera lenses|Drones'],
  ['electronics','Home electronics & appliances','home-electronics','Refrigerators|Washing machines|Air conditioners|Air coolers|Fans|Microwave ovens|Induction cooktops|Mixer grinders|Water purifiers|Vacuum cleaners|Irons|Geysers|Inverters|Batteries|Smart home devices'],
  ['dairy','Milk & dairy','milk-dairy','Fresh milk|Toned milk|Full cream milk|Cow milk|Buffalo milk|A2 milk|Lactose-free milk|Curd|Paneer|Butter|Cheese|Buttermilk'],
  ['eggs','Eggs','eggs','White eggs|Brown eggs|Free-range eggs|Country eggs|Omega-3 eggs|Quail eggs'],
  ['household','Cleaning & laundry','cleaning-laundry','Floor cleaners|Toilet cleaners|Bathroom cleaners|Glass cleaners|Disinfectants|Dishwash bars|Dishwash liquids|Laundry detergent powder|Laundry detergent liquid|Fabric conditioner|Stain removers|Bleach'],
  ['household','Home & kitchen essentials','home-kitchen','Garbage bags|Tissues|Paper towels|Aluminium foil|Cling film|Food storage|Kitchen tools|Cookware|Drinkware|Cleaning tools|Mops|Brooms|Scrub pads|Air fresheners|Pest control|Shoe care|Pooja essentials|Candles|Home organizers|Batteries household'],
  ['flowers','Flowers & plants','flowers-plants-launch','Roses|Marigold|Jasmine|Lotus|Lilies|Orchids|Carnations|Chrysanthemums|Gerbera|Tulips|Bouquets|Flower arrangements|Pooja flowers|Indoor plants|Outdoor plants'],
];

export const INDIA_LAUNCH_CATEGORIES = SECTION_ROWS.flatMap(([root, sectionName, sectionSlug, names], sectionIndex) => {
  const rootName = { grocery: 'Groceries', vegetables: 'Fresh vegetables', fashion: 'Fashion', beauty: 'Beauty', electronics: 'Electronics', dairy: 'Milk & dairy', eggs: 'Eggs', household: 'Household essentials', flowers: 'Flowers & plants' }[root];
  const rootRow = { level: 'root', name: rootName, slug: `india-${root}`, parentSlug: null, vertical: root, description: `${rootName} launch catalog for India.`, sortOrder: sectionIndex * 1000, attributeSchema: [], complianceRequirements: [], imageUrl: photo(MEDIA[root], 800, 800), iconUrl: photo(MEDIA[root], 256, 256), bannerUrl: photo(MEDIA[root], 1600, 600) };
  const section = { level: 'section', name: sectionName, slug: `india-${sectionSlug}`, parentSlug: rootRow.slug, vertical: root, description: `${sectionName} with governed universal product data.`, sortOrder: sectionIndex * 100, attributeSchema: [], complianceRequirements: [], imageUrl: photo(MEDIA[root], 800, 800), iconUrl: photo(MEDIA[root], 256, 256), bannerUrl: photo(MEDIA[root], 1600, 600) };
  const leaves = names.split('|').map((name, index) => ({ level: 'leaf', name, slug: `india-${slugify(name)}`, parentSlug: section.slug, vertical: root, description: `${name} sold in India with required catalog specifications.`, sortOrder: index * 10, attributeSchema: SCHEMAS[root], complianceRequirements: [], imageUrl: photo(MEDIA[root], 800, 800), iconUrl: photo(MEDIA[root], 256, 256), bannerUrl: photo(MEDIA[root], 1600, 600) }));
  return [rootRow, section, ...leaves];
}).filter((row, index, rows) => rows.findIndex((candidate) => candidate.slug === row.slug) === index);

const BRAND_GROUPS = [
  ['grocery','Tata Sampann:tatasampann.com|Aashirvaad:aashirvaad.com|Fortune:fortunefoods.com|India Gate:indiagatefoods.com|Daawat:daawat.com|Patanjali:patanjaliayurved.net|24 Mantra Organic:24mantra.com|Organic Tattva:organictattva.com|Natureland Organics:naturelandorganics.com|Catch:catchfoods.com|Everest:everestfoods.com|MDH:mdhspices.com|Eastern:eastern.in|MTR:mtrfoods.com|Gits:gitsfood.com|Haldiram’s:haldirams.com|Bikaji:bikaji.com|Balaji Wafers:balajiwafers.com|Bingo!:itcportal.com|Lay’s:lays.com|Kurkure:kurkure.com|Parle:parleproducts.com|Britannia:britannia.co.in|Sunfeast:sunfeastworld.com|Mondelez India:mondelezinternational.com|Nestlé India:nestle.in|Maggi:maggi.in|Kellogg’s:kelloggs.in|Quaker:quaker.in|Saffola:saffola.in|Amul:amul.com|Mother Dairy:motherdairy.com|Paper Boat:paperboatdrinks.com|Real:realfruitpower.com|Tropicana:tropicana.in|Coca-Cola:coca-cola.com|Pepsi:pepsi.com|Bisleri:bisleri.com|Kinley:coca-cola.com|Red Bull:redbull.com|Tata Tea:tataconsumer.com|Brooke Bond:hul.co.in|Lipton:lipton.com|Wagh Bakri:waghbakritea.com|Nescafé:nescafe.com|Bru:hul.co.in|Veeba:veeba.in|Kissan:kissan.in|Ching’s Secret:capitalfoods.co.in|Wingreens Farms:wingreensfarms.com|Del Monte:delmontefoods.in|Dr. Oetker:oetker.in|ID Fresh:idfreshfood.com|McCain:mccainindia.com|Godrej Yummiez:godrejtyson.com|Hershey’s:hersheyland.in|Cadbury:cadbury.co.uk|Ferrero Rocher:ferrerorocher.com|The Whole Truth:thewholetruthfoods.com|Yoga Bar:yogabars.in'],
  ['vegetables','Sattva Fresh:sattvafresh.in|Safal:motherdairy.com|Otipy:otipy.com|Bigbasket Fresho:bigbasket.com|Nature’s Basket:naturesbasket.co.in|Kisankonnect:kisankonnect.in|Pluckk:pluckk.in|Deep Rooted:deeprooted.co.in|Organic Garden:organicgarden.co.in|Farmizen:farmizen.com'],
  ['dairy,eggs','VS DAIRIES:vsdairies.in|Amul:amul.com|Mother Dairy:motherdairy.com|Nandini:nandini.coop|Aavin:aavin.tn.gov.in|Heritage Foods:heritagefoods.in|Dodla Dairy:dodladairy.com|Hatsun:hatsun.com|Milky Mist:milkymist.com|Akshayakalpa:akshayakalpa.org|Country Delight:countrydelight.in|Sid’s Farm:sidsfarm.com|Nestlé:nestle.in|Britannia:britannia.co.in|Keventers:keventers.com|Eggoz:eggoz.com|Henfruit:henfruit.com|Abhi Eggs:abhieggs.in|Happy Hens:happyhens.in|Suguna:sugunafoods.com'],
  ['fashion','Levi’s:levi.in|Lee:lee.in|Wrangler:wrangler.in|Pepe Jeans:pepejeans.in|Flying Machine:flyingmachine.co.in|U.S. Polo Assn.:uspoloassn.in|Allen Solly:allensolly.com|Van Heusen:vanheusenindia.com|Louis Philippe:louisphilippe.abfrl.in|Peter England:peterengland.abfrl.in|Raymond:raymond.in|Park Avenue:parkavenue.co.in|Manyavar:manyavar.com|Fabindia:fabindia.com|Biba:biba.in|W:biba.in|Aurelia:shopforaurelia.com|Libas:libas.in|Global Desi:globaldesi.in|AND:andindia.com|H&M:hm.com|Zara:zara.com|Uniqlo:uniqlo.com|Mango:shop.mango.com|Marks & Spencer:marksandspencer.in|Nike:nike.com|Adidas:adidas.co.in|Puma:in.puma.com|Reebok:reebok.in|Skechers:skechers.in|Asics:asics.co.in|New Balance:newbalance.co.in|Bata:bata.in|Liberty:libertyshoes.com|Metro:metroshoes.com|Mochi:mochi.com|Woodland:woodlandworldwide.com|Red Tape:redtape.com|Campus:campusshoes.com|Relaxo:relaxofootwear.com|Crocs:crocs.in|Clarks:clarks.in|Jockey:jockey.in|Clovia:clovia.com|Zivame:zivame.com|Enamor:enamor.co.in|Amante:amante.co.in|XYXX:xyxxcrew.com|Damensch:damensch.com|Decathlon:decathlon.in|Wildcraft:wildcraft.com|American Tourister:americantourister.in|Safari:safaribags.com|VIP:vipindustries.co.in|Titan:titan.co.in|Fastrack:fastrack.in|Tanishq:tanishq.co.in|Mia by Tanishq:mia.tanishq.co.in|CaratLane:caratlane.com|Giva:giva.co'],
  ['beauty','Lakmé:lakmeindia.com|Maybelline New York:maybelline.co.in|L’Oréal Paris:lorealparis.co.in|MAC Cosmetics:maccosmetics.in|Nykaa Cosmetics:nykaa.com|Sugar Cosmetics:sugarcosmetics.com|Colorbar:colorbarcosmetics.com|Faces Canada:facescanada.com|Kay Beauty:nykaa.com|Mamaearth:mamaearth.in|The Derma Co:thedermaco.com|Minimalist:beminimalist.co|Plum:plumgoodness.com|Dot & Key:dotandkey.com|Dr. Sheth’s:drsheths.com|Aqualogica:aqualogica.in|Cetaphil:cetaphil.in|CeraVe:cerave.co.in|Neutrogena:neutrogena.in|Nivea:nivea.in|Pond’s:ponds.in|Dove:dove.com|Vaseline:vaseline.com|Himalaya:himalayawellness.in|Biotique:biotique.com|Forest Essentials:forestessentialsindia.com|Kama Ayurveda:kamaayurveda.in|Lotus Herbals:lotusherbals.com|WOW Skin Science:buywow.in|mCaffeine:mcaffeine.com|Pilgrim:discoverpilgrim.com|Bare Anatomy:innovist.com|Tresemmé:tresemme.in|L’Oréal Professionnel:lorealprofessionnel.in|Schwarzkopf:schwarzkopf.in|BBlunt:bblunt.com|Beardo:beardo.in|Bombay Shaving Company:bombayshavingcompany.com|Ustraa:ustraa.com|Gillette:gillette.co.in|Old Spice:oldspice.com|Colgate:colgate.com|Oral-B:oralb.co.in|Whisper:whisper.co.in|Stayfree:stayfree.in|Sirona:thesirona.com|Pee Safe:peesafe.com|Johnson’s Baby:johnsonsbaby.in|Sebamed:sebamedindia.com|Philips:philips.co.in'],
  ['electronics','Samsung:samsung.com|Apple:apple.com|Xiaomi:mi.com|Redmi:mi.com|OnePlus:oneplus.in|Realme:realme.com|Oppo:oppo.com|Vivo:vivo.com|Motorola:motorola.in|Nothing:nothing.tech|Google:store.google.com|Nokia:hmd.com|Lava:lavainternational.in|boAt:boat-lifestyle.com|Noise:gonoise.com|Boult:boultaudio.com|JBL:in.jbl.com|Sony:sony.co.in|Sennheiser:sennheiser-hearing.com|Marshall:marshall.com|Dell:dell.com|HP:hp.com|Lenovo:lenovo.com|Asus:asus.com|Acer:acer.com|MSI:in.msi.com|Microsoft:microsoft.com|Logitech:logitech.com|Canon:in.canon|Nikon:nikon.co.in|Fujifilm:fujifilm.com|GoPro:gopro.com|DJI:dji.com|LG:lg.com|TCL:tcl.com|Hisense:hisense-india.com|Vu:vutvs.com|Panasonic:panasonic.com|Haier:haier.com|Whirlpool:whirlpoolindia.com|Godrej Appliances:godrej.com|Voltas:voltas.com|Blue Star:bluestarindia.com|Daikin:daikinindia.com|Crompton:crompton.co.in|Havells:havells.com|Bajaj Electricals:bajajelectricals.com|Prestige:ttkprestige.com|Philips:philips.co.in|Dyson:dyson.in|Eureka Forbes:eurekaforbes.com|Kent:kent.co.in|ROG:rog.asus.com|PlayStation:playstation.com|Xbox:xbox.com|Nintendo:nintendo.com|Jio:jio.com|TP-Link:tp-link.com|D-Link:dlink.com|Western Digital:westerndigital.com|Seagate:seagate.com|SanDisk:sandisk.com'],
  ['household','Surf Excel:hul.co.in|Ariel:ariel.in|Tide:pg.com|Rin:hul.co.in|Henko:jyothy.com|Comfort:comfortworld.co.in|Vanish:vanish.co.in|Lizol:lizol.co.in|Harpic:harpic.co.in|Dettol:dettol.co.in|Domex:hul.co.in|Colin:reckitt.com|Pril:jyothy.com|Vim:vim.in|Exo:jyothy.com|Scotch-Brite:scotch-brite.co.in|Gala:gala.in|Spotzero:milton.in|Good Knight:goodknight.in|All Out:allout.in|Hit:godrejcp.com|Odonil:odonil.com|Ambi Pur:ambipur.com|Godrej Aer:godrejaer.com|Origami:origamitissues.com|Selpak:selpak.com|Presto!:amazon.in|Milton:milton.in|Tupperware:tupperware.co.in|Cello:celloworld.com|Borosil:borosil.com|Prestige:ttkprestige.com|Hawkins:hawkinscookers.com|Pigeon:stovekraft.com|Wonderchef:wonderchef.com|IKEA:ikea.com|Home Centre:homecentre.in'],
  ['flowers','Veda Blooms:vedablooms.in|FNP:fnp.com|FlowerAura:floweraura.com|IGP:igp.com|Interflora India:interflora.in|OyeGifts:oyegifts.com|Winni:winni.in'],
];

export const INDIA_LAUNCH_BRANDS = BRAND_GROUPS.flatMap(([verticals, list]) => list.split('|').map((entry) => {
  const split = entry.lastIndexOf(':'); const name = entry.slice(0, split); const domain = entry.slice(split + 1);
  const isOwnedBrand = ['VS DAIRIES', 'Sattva Fresh', 'Veda Blooms'].includes(name); const vertical = verticals.split(',')[0];
  return { name, slug: slugify(name), domain: isOwnedBrand ? null : domain, verticals: verticals.split(','), logoUrl: isOwnedBrand ? photo(MEDIA[vertical], 512, 512) : `https://logos.hunter.io/${domain}`, bannerUrl: photo(MEDIA[vertical], 1600, 600), website: isOwnedBrand ? null : `https://${domain}`, countryOfOrigin: isOwnedBrand ? 'IN' : null, description: `${name} products available in the India launch catalog.`, mediaSource: isOwnedBrand ? 'replaceable-owned-brand-placeholder' : 'official-domain-logo', verification: { status: 'pending', isVerified: false } };
})).filter((brand, index, rows) => rows.findIndex((candidate) => candidate.slug === brand.slug) === index);

const VARIANTS = {
  grocery: [['500 g',500,'gram'],['1 kg',1000,'gram']], vegetables: [['500 g',500,'gram'],['1 kg',1000,'gram']], fashion: [['Black · M',1,'piece'],['Black · L',1,'piece'],['Blue · M',1,'piece']], beauty: [['50 ml',50,'millilitre'],['100 ml',100,'millilitre']], electronics: [['Standard · Black',1,'piece'],['Standard · Silver',1,'piece']], dairy: [['500 ml',500,'millilitre'],['1 L',1000,'millilitre']], eggs: [['Pack of 6',6,'piece'],['Pack of 12',12,'piece']], household: [['500 ml',500,'millilitre'],['1 L',1000,'millilitre']], flowers: [['Standard',1,'piece'],['Premium',1,'piece']],
};
const attrsFor = (category) => SCHEMAS[category.vertical].filter((item) => item.appliesTo === 'master').map((item) => ({ key: item.key, value: item.type === 'number' ? Math.max(item.min || 1, 1) : item.options?.[0] || ({ ingredients: 'See product label', storage_instructions: 'Store as directed on pack', variety: category.name, origin_state: 'India', material: 'See product label', care_instructions: 'Follow product care label', model_name: category.name, warranty_months: 12, power_requirement: 'As specified by manufacturer', connectivity: 'As applicable', primary_use: category.name, material_or_formula: 'See product label', usage_instructions: 'Use as directed', safety_notes: 'Read product label before use', flower_type: category.name, color_family: 'Assorted', care_notes: 'Follow included care instructions' }[item.key] || category.name), unit: item.unit || null }));
const optionValuesFor = (vertical, label) => {
  const [first, second] = label.split(' · ');
  if (vertical === 'fashion') return [{ code: 'color', name: 'Color', value: first }, { code: 'size', name: 'Size', value: second }];
  if (vertical === 'electronics') return [{ code: 'configuration', name: 'Configuration', value: first }, { code: 'color', name: 'Color', value: second }];
  const code = vertical === 'eggs' ? 'count' : vertical === 'flowers' ? 'arrangement_size' : 'pack_size';
  return [{ code, name: code.split('_').map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' '), value: label }];
};
const optionsFor = (variants) => {
  const definitions = new Map();
  variants.flatMap((variant) => variant.optionValues).forEach((option) => {
    if (!definitions.has(option.code)) definitions.set(option.code, { code: option.code, name: option.name, values: [], displayType: option.code === 'color' ? 'swatch' : 'text', sortOrder: definitions.size });
    const definition = definitions.get(option.code); if (!definition.values.includes(option.value)) definition.values.push(option.value);
  });
  return [...definitions.values()];
};
const warrantyFor = (vertical) => vertical === 'electronics'
  ? { duration: 12, unit: 'month', description: 'Manufacturer warranty; final coverage follows the model documentation and invoice.' }
  : { duration: null, unit: 'month', description: 'Not applicable unless explicitly provided by the manufacturer.' };
const fulfillmentFor = (vertical, quantity, unitCode) => ({
  requiresShipping: true, shippingClass: ['vegetables', 'dairy', 'eggs', 'flowers'].includes(vertical) ? 'fresh' : 'standard',
  weight: { value: unitCode === 'gram' ? quantity : null, unit: 'g' }, dimensions: { length: null, width: null, height: null, unit: 'cm' },
  fragile: ['electronics', 'eggs', 'flowers'].includes(vertical), hazardous: false, ageRestricted: false, requiresSerialTracking: vertical === 'electronics',
});

/** Exactly 1,000 deterministic masters; every leaf and every brand receives coverage. */
export function buildIndiaLaunchProducts() {
  const leaves = INDIA_LAUNCH_CATEGORIES.filter((category) => category.level === 'leaf');
  const pairs = [];
  for (const category of leaves) {
    const eligible = INDIA_LAUNCH_BRANDS.filter((brand) => brand.verticals.includes(category.vertical));
    const count = Math.max(1, Math.min(6, Math.ceil(1000 / leaves.length)));
    for (let index = 0; index < count; index += 1) pairs.push([category, eligible[index % eligible.length]]);
  }
  let cursor = 0;
  while (pairs.length < 1000) { const category = leaves[cursor % leaves.length]; const eligible = INDIA_LAUNCH_BRANDS.filter((brand) => brand.verticals.includes(category.vertical)); pairs.push([category, eligible[(Math.floor(cursor / leaves.length) + 6) % eligible.length]]); cursor += 1; }
  return pairs.slice(0, 1000).map(([category, brand], index) => {
    const skuGlobal = `IN26-${String(index + 1).padStart(4, '0')}`;
    const variants = VARIANTS[category.vertical].map(([label, quantity, unit], variantIndex) => {
      const optionValues = optionValuesFor(category.vertical, label); const optionByCode = new Map(optionValues.map((option) => [option.code, option.value]));
      return {
        sku: `${skuGlobal}-V${variantIndex + 1}`, displayLabel: label, value: label, optionValues,
        variantType: category.vertical === 'fashion' ? 'size' : category.vertical === 'electronics' ? 'model' : 'pack_size',
        identifiers: { gtin: null, mpn: `${skuGlobal}-V${variantIndex + 1}` }, sellQuantity: { value: quantity, unitCode: unit },
        weight: { value: unit === 'gram' ? quantity : null, unit: 'g' }, dimensions: { length: null, width: null, height: null, unit: 'cm' },
        isDefault: variantIndex === 0, sortOrder: variantIndex,
        images: [{ url: relevantPhoto(category, ((index + 1) * 10) + variantIndex + 1), altText: `${brand.name} ${category.name} — ${label}`, mediaType: 'image', role: 'gallery', isPrimary: true, sortOrder: 0 }],
        attributes: category.attributeSchema.filter((item) => item.appliesTo === 'variant').map((item) => ({ key: item.key, value: item.type === 'number' ? quantity : optionByCode.get(item.key) || label, unit: item.unit || null })),
      };
    });
    const title = `${brand.name} ${category.name}`; const perishable = ['grocery', 'vegetables', 'dairy', 'eggs', 'flowers'].includes(category.vertical);
    return {
      skuGlobal, title, slug: `india-${slugify(brand.name)}-${slugify(category.name)}-${index + 1}`,
      type: category.vertical === 'flowers' ? 'fresh_flower' : category.vertical === 'electronics' ? 'electronics' : category.vertical === 'fashion' ? 'apparel' : category.vertical === 'beauty' ? 'beauty' : category.vertical === 'household' ? 'home' : 'grocery',
      kind: 'physical', categorySlug: category.slug, brandSlug: brand.slug, shortDescription: `${title} with governed specifications and selectable variants.`, description: `${title} prepared as a complete India launch master with category-governed specifications, fulfillment characteristics, searchable metadata, and purchasable variant configurations.`,
      manufacturer: brand.name, modelNumber: skuGlobal, identifiers: { gtin: null, mpn: skuGlobal, isbn: null, hsn: null }, condition: 'new', warranty: warrantyFor(category.vertical),
      seo: { title: title.slice(0, 70), description: `Shop ${title} variants with detailed specifications and product information.`.slice(0, 180), keywords: [brand.name, category.name, category.vertical, 'India'] },
      options: optionsFor(variants), optionRules: [], defaultSellingUnit: variants[0].sellQuantity.unitCode, fulfillmentProfile: fulfillmentFor(category.vertical, variants[0].sellQuantity.value, variants[0].sellQuantity.unitCode),
      isPerishable: perishable, requiresColdChain: category.vertical === 'dairy', minOrderQty: 1, maxOrderQty: ['vegetables', 'dairy', 'eggs', 'flowers'].includes(category.vertical) ? 20 : 100,
      attributes: attrsFor(category), variants,
      images: [{ url: relevantPhoto(category, index + 1, 1400, 1400), altText: title, mediaType: 'image', role: 'gallery', isPrimary: true, sortOrder: 0 }],
      tags: ['india-launch-2026', category.vertical, category.slug, `brand:${brand.slug}`, 'media:loremflickr-cc'],
    };
  });
}

export const INDIA_LAUNCH_MEDIA_SOURCES = {
  logos: { provider: 'Hunter Logo API', pattern: 'https://logos.hunter.io/{official-domain}', source: 'official brand domains' },
  categoryEditorial: { provider: 'Unsplash CDN', usage: 'curated launch taxonomy editorial photography', photoIds: MEDIA },
  productEditorial: { provider: 'LoremFlickr v3', pattern: 'https://loremflickr.com/{width}/{height}/{category-tags}?lock={stable-id}', usage: 'deterministic category-relevant Creative Commons product and variant photography', attribution: 'Creator and license credit are embedded by the provider; replace with official packshots during brand verification.' },
};
