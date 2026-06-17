window.GRADUATION_CONFIG = {
  event: {
    title: "Elizabeth & Angel's OIT MLS Graduation",
    kicker: "OIT Medical Laboratory Science",
    subtitle: "A December graduation celebration page for RSVPs, travel details, and anonymous love notes.",
    dateText: "December 2026",
    timeText: "Time TBA",
    locationName: "Oregon Tech - Klamath Falls Campus",
    address: "3201 Campus Drive, Klamath Falls, OR 97601",
    googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=3201%20Campus%20Drive%2C%20Klamath%20Falls%2C%20OR%2097601",
    statusText: "Editable page",
    note: "Final date, room, and Canva invitation can be added later.",
    inviteCopy: "When the final invitation image is ready, put it in assets/ and update invitationImage below."
  },

  admin: {
    previewPassword: "cats"
  },

  links: {
    liveSiteUrl: ""
  },

  assets: {
    heroImage: "https://www.oit.edu/sites/default/files/2022-02/CampusDJI_0015.jpg",
    invitationImage: "",
    photos: [
      {
        src: "https://www.oit.edu/sites/default/files/2022-02/CampusDJI_0015.jpg",
        alt: "Oregon Tech Klamath Falls campus"
      },
      {
        src: "https://www.oit.edu/sites/default/files/2020/images/OIT-Sign.jpg",
        alt: "Oregon Institute of Technology campus sign"
      },
      {
        src: "https://www.oit.edu/sites/default/files/styles/full_width_image/public/full-width/kfalls_Rural%20Phto.jpg.webp?h=2c9f97a4&itok=er1y1IZ3",
        alt: "Klamath Falls lake view from Oregon Tech"
      }
    ]
  },

  weather: {
    label: "Klamath Falls",
    latitude: 42.255,
    longitude: -121.785
  },

  stay: [
    {
      name: "Hotels near Oregon Tech",
      meta: "Google Maps search",
      url: "https://www.google.com/maps/search/hotels+near+Oregon+Tech+Klamath+Falls"
    },
    {
      name: "Downtown Klamath Falls stays",
      meta: "Good area to compare options",
      url: "https://www.google.com/maps/search/hotels+in+downtown+Klamath+Falls"
    },
    {
      name: "Running Y area lodging",
      meta: "Resort area outside town",
      url: "https://www.google.com/maps/search/Running+Y+Resort+lodging"
    }
  ],

  food: [
    {
      name: "Food near Oregon Tech",
      meta: "Google Maps search",
      url: "https://www.google.com/maps/search/restaurants+near+Oregon+Tech+Klamath+Falls"
    },
    {
      name: "Downtown Klamath Falls food",
      meta: "Restaurants and coffee",
      url: "https://www.google.com/maps/search/restaurants+in+downtown+Klamath+Falls"
    },
    {
      name: "Coffee near campus",
      meta: "Quick stops before the ceremony",
      url: "https://www.google.com/maps/search/coffee+near+Oregon+Tech+Klamath+Falls"
    }
  ],

  supabase: {
    enabled: false,
    url: "",
    anonKey: "",
    tablePrefix: "graduation_",
    adminEndpoint: ""
  }
};
