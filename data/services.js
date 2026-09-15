const services = [
  // HAIR
  { id: 1, title: "Haircut + Blowdry", category: "Hair", description: "A fresh cut paired with a smooth, salon-fresh blowdry finish.", price: "₱99" },
  { id: 2, title: "Hairwash + Blowdry", category: "Hair", description: "Relaxing wash followed by professional styling.", price: "₱99" },
  { id: 3, title: "Wash + Blow + Haircut", category: "Hair", description: "Complete hair refresh — wash, style, and cut in one visit.", price: "₱199" },
  { id: 4, title: "Hair Iron", category: "Hair", description: "Sleek, straight styling using professional flat irons.", price: "₱399" },

  // HAIR TREATMENT
  { id: 5, title: "Brazilian", category: "Hair Treatment", description: "Smoothing keratin treatment that reduces frizz and adds shine.", price: "₱499 - ₱699" },
  { id: 6, title: "Botox", category: "Hair Treatment", description: "Deep repair treatment that restores strength and softness.", price: "₱799 - ₱999" },
  { id: 7, title: "Collagen", category: "Hair Treatment", description: "Intensive conditioning treatment for damaged, dry hair.", price: "₱1,199 - ₱1,499" },
  { id: 8, title: "Kera-collagen", category: "Hair Treatment", description: "Our premium dual treatment for maximum smoothness and strength.", price: "₱2,499 - ₱2,999" },
  { id: 41, title: "Cystein", category: "Hair Treatment", description: "Restorative treatment that rebuilds hair structure from within.", price: "₱2,500 - ₱5,000" },
  { id: 42, title: "Protein Straight", category: "Hair Treatment", description: "Protein-infused straightening for smooth, healthy-looking hair.", price: "₱3,500 - ₱7,000" },

  // NAILS
  { id: 9, title: "Manicure", category: "Nails", description: "Classic nail shaping and cuticle care for polished hands.", price: "₱99" },
  { id: 10, title: "Pedicure", category: "Nails", description: "Relaxing foot treatment with nail care and shaping.", price: "₱149" },
  { id: 11, title: "Gel Polish", category: "Nails", description: "Long-lasting, chip-resistant gel color application.", price: "₱349" },
  { id: 12, title: "Gel Removal", category: "Nails", description: "Safe and gentle removal of existing gel polish.", price: "₱99" },
  { id: 13, title: "Soft Gel Nail Extensions", category: "Nails", description: "Natural-looking nail extensions using soft gel technique.", price: "₱799" },
  { id: 14, title: "Nail Extensions Removal", category: "Nails", description: "Careful removal of nail extensions without damage.", price: "₱149" },
  { id: 15, title: "Footspa", category: "Nails", description: "Soothing foot soak and scrub for tired feet.", price: "₱199" },
  { id: 16, title: "Hand & Foot Massage", category: "Nails", description: "Relaxing massage to relieve tension in hands and feet.", price: "₱199" },

  // HIGHLIGHTS/BALAYAGE
  { id: 17, title: "Highlights/Balayage + Collagen", category: "Highlights/Balayage", description: "Dimensional color with a nourishing collagen treatment included.", price: "₱2,499 - ₱2,999" },
  { id: 18, title: "Highlights/Balayage + Plex + Collagen", category: "Highlights/Balayage", description: "Our full protective color package for healthy, vibrant results.", price: "₱2,999 - ₱3,499" },

  // REBOND PACKAGE
  { id: 19, title: "Rebond + Brazilian", category: "Rebond Package", description: "Permanent straightening paired with a smoothing treatment.", price: "₱1,499 - ₱1,999" },
  { id: 20, title: "Rebond + Botox", category: "Rebond Package", description: "Straightening combined with deep repair for stronger strands.", price: "₱1,799 - ₱2,299" },
  { id: 21, title: "Rebond + Collagen", category: "Rebond Package", description: "Full rebond service with intensive conditioning treatment.", price: "₱1,999 - ₱2,499" },
  { id: 22, title: "Rebond + Kera-collagen", category: "Rebond Package", description: "Premium rebond with our top-tier dual treatment.", price: "₱2,999 - ₱3,499" },

  // DELUXE PACKAGE
  { id: 23, title: "Rebond + Color + Brazilian", category: "Deluxe Package", description: "Straighten, color, and smooth — all in one visit.", price: "₱1,999 - ₱2,499" },
  { id: 24, title: "Rebond + Color + Botox", category: "Deluxe Package", description: "Color and straightening with deep repair treatment.", price: "₱2,299 - ₱2,799" },
  { id: 25, title: "Rebond + Color + Collagen", category: "Deluxe Package", description: "Complete transformation with intensive conditioning.", price: "₱2,499 - ₱2,999" },
  { id: 26, title: "Rebond + Color + Kera-collagen", category: "Deluxe Package", description: "Our top rebond and color combo with premium treatment.", price: "₱3,499 - ₱3,999" },

  // PRESTIGE PACKAGE
  { id: 27, title: "Rebond + Color + Plex + Brazilian", category: "Prestige Package", description: "The ultimate hair transformation with full protection.", price: "₱2,499 - ₱2,999" },
  { id: 28, title: "Rebond + Color + Plex + Botox", category: "Prestige Package", description: "Complete makeover with bond protection and deep repair.", price: "₱2,799 - ₱3,299" },
  { id: 29, title: "Rebond + Color + Plex + Collagen", category: "Prestige Package", description: "Full-service transformation with intensive conditioning.", price: "₱2,999 - ₱3,499" },
  { id: 30, title: "Rebond + Color + Plex + Kera-collagen", category: "Prestige Package", description: "Our best-selling package — total hair renewal.", price: "₱3,999 - ₱4,499" },

  // COLOR PACKAGE
  { id: 31, title: "Color + Keratin", category: "Color Package", description: "Fresh color with a smoothing keratin finish.", price: "₱999" },
  { id: 32, title: "Color + Brazilian", category: "Color Package", description: "Vibrant color paired with a frizz-smoothing treatment.", price: "₱1,499 - ₱1,999" },
  { id: 33, title: "Color + Botox", category: "Color Package", description: "Fresh color with deep repair for healthier-looking hair.", price: "₱1,799 - ₱2,299" },
  { id: 34, title: "Color + Collagen", category: "Color Package", description: "Color service with intensive conditioning treatment.", price: "₱1,999 - ₱2,499" },
  { id: 35, title: "Color + Kera-collagen", category: "Color Package", description: "Premium color combined with our top-tier treatment.", price: "₱2,999 - ₱3,499" },

  // COLOR PACKAGE + PLEX
  { id: 36, title: "Color + Keratin + Plex", category: "Color Package + Plex", description: "Color and smoothing with added bond protection.", price: "₱1,499 - ₱1,999" },
  { id: 37, title: "Color + Brazilian + Plex", category: "Color Package + Plex", description: "Full color service with frizz control and bond care.", price: "₱1,999 - ₱2,499" },
  { id: 38, title: "Color + Botox + Plex", category: "Color Package + Plex", description: "Color, repair, and bond protection in one service.", price: "₱2,299 - ₱2,799" },
  { id: 39, title: "Color + Collagen + Plex", category: "Color Package + Plex", description: "Complete color care with conditioning and bond protection.", price: "₱2,499 - ₱2,999" },
  { id: 40, title: "Color + Kera-collagen + Plex", category: "Color Package + Plex", description: "Our most premium color package, fully protected.", price: "₱3,499 - ₱3,999" },

  // PROMOS
  { id: 43, title: "Glow Package (Gel Polish + Pedicure + Footspa + Massage)", category: "Promos", description: "Complete nail and foot pampering bundle at a special price.", price: "₱599" },
  { id: 44, title: "Indulgence Package (Soft Gel Nail Extensions + Pedicure + Footspa + Massage)", category: "Promos", description: "Our full nail extension bundle with foot pampering included.", price: "₱999" },
  { id: 45, title: "Soft Gel Nail Extensions — Full Design", category: "Promos", description: "Fully designed soft gel nail extensions at half the price.", price: "₱499" },
];

module.exports = services;