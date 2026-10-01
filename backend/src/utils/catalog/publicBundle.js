/** Customer-safe projection for a bundle's active component graph. */
export function publicBundleComponents(components = []) {
  return components
    .filter((component) => !component.status || component.status === 'active')
    .map((component) => ({
      id: String(component._id || component.id),
      componentMasterId: String(component.componentMasterId),
      componentVariantId: component.componentVariantId ? String(component.componentVariantId) : null,
      quantity: component.quantity,
      unitCode: component.unitCode,
      selectionGroup: component.selectionGroup || 'included',
      required: component.required !== false,
      defaultSelected: component.defaultSelected !== false,
      minSelections: component.minSelections ?? 1,
      maxSelections: component.maxSelections ?? 1,
      priceAdjustment: component.priceAdjustment || 0,
      sortOrder: component.sortOrder ?? 0,
      product: component.product ? {
        id: String(component.product._id || component.product.id),
        title: component.product.title,
        slug: component.product.slug,
        kind: component.product.kind,
        type: component.product.type,
        shortDescription: component.product.shortDescription || null,
        manufacturer: component.product.manufacturer || null,
        modelNumber: component.product.modelNumber || null,
        condition: component.product.condition || null,
        countryOfOrigin: component.product.countryOfOrigin || null,
        defaultSellingUnit: component.product.defaultSellingUnit || null,
        warranty: component.product.warranty || null,
        tags: component.product.tags || [],
        imageUrl: component.product.imageUrl || component.media?.url || null,
      } : null,
      variant: component.variant ? {
        id: String(component.variant._id || component.variant.id),
        displayLabel: component.variant.displayLabel || null,
        value: component.variant.value || null,
        combinationKey: component.variant.combinationKey || null,
        optionValues: component.variant.optionValues || [],
        sellQuantity: component.variant.sellQuantity || null,
      } : null,
      media: component.media ? {
        url: component.media.url,
        altText: component.media.altText || component.product?.title || null,
        mediaType: component.media.mediaType || 'image',
        role: component.media.role || 'gallery',
        width: component.media.width || null,
        height: component.media.height || null,
        focalPoint: component.media.focalPoint || null,
        source: component.media.source || 'master',
      } : null,
    }));
}

export default publicBundleComponents;
