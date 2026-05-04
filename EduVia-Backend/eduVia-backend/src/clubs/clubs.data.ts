export type ClubSeed = {
  name: string;
  category: string;
  description: string;
  objectives: string[];
  activities: string[];
  facebook: string;
  email: string;
};

export const CLUBS: ClubSeed[] = [
  {
    name: 'Esprit-Dev',
    category: 'Programmation / Algorithmique',
    description:
      'Club oriente algorithmique, programmation competitive et accompagnement des etudiants en difficulte en programmation.',
    objectives: [
      "Actions de sensibilisation a la Science de l'Algorithme",
      'Elaborer des formations pour aider les etudiants ayant des difficultes en programmation',
      'Organiser le concours interne Esprit CPC',
      'Preparer les equipes qui vont participer au TCPC',
    ],
    activities: [
      'Formations en programmation',
      'Concours internes',
      'Preparation aux competitions',
    ],
    facebook: '',
    email: '',
  },
  {
    name: 'Esprit FUTURA',
    category: 'Entrepreneuriat / Culture',
    description:
      'Club cree en 2010 par des etudiants motives et encadres par des enseignants, le club organise des activites culturelles dans le domaine de l entrepreneuriat.',
    objectives: [
      'Partager des idees et des connaissances dans un esprit convivial',
    ],
    activities: ['Evenements culturels', 'Activites entrepreneuriales'],
    facebook: '',
    email: 'esprit-club-futura@esprit.tn',
  },
  {
    name: 'ESPRIT Club AERO',
    category: 'Aeronautique',
    description:
      'Fonde en 2014, le Club AERO ESPRIT repose sur l echange, le partage de connaissances, l innovation et la creativite.',
    objectives: ['Developper les competences dans le domaine aeronautique'],
    activities: [
      'Aeronautique generale',
      'Aeromodelisme',
      'Systemes avioniques embarques',
    ],
    facebook: '',
    email: 'esprit-club-aero@esprit.tn',
  },
  {
    name: 'Japanese Club of Esprit (JCE)',
    category: 'Culture',
    description:
      'Fonde en fevrier 2013, le JCE permet aux etudiants tunisiens et etrangers de decouvrir la culture et le mode de vie japonais.',
    objectives: [
      'Faire decouvrir la culture japonaise',
      'Renforcer les liens entre la Tunisie et le Japon',
    ],
    activities: ['Evenements culturels', 'Decouverte du Japon'],
    facebook: '',
    email: '',
  },
  {
    name: 'ESPRIT Club ESPOIR',
    category: 'Humanitaire',
    description:
      'Fonde le 3 decembre 2016, le club aide les ONG et associations humanitaires dans leurs actions aupres des populations indigentes.',
    objectives: [
      'Assister les ONG',
      'Mettre en relation associations et etudiants benevoles',
    ],
    activities: [
      'Missions humanitaires',
      'Benevolat',
      'Collaboration avec associations',
    ],
    facebook: '',
    email: 'esprit-club-espoir@esprit.tn',
  },
  {
    name: 'ESPRIT Club FUSION',
    category: 'Robotique / Mecanique / Electronique',
    description:
      'Club scientifique cree en 2017, specialise dans la conception mecanique, electrique et robotique.',
    objectives: ['Realiser des projets scientifiques et techniques'],
    activities: ['Conception mecanique', 'Electronique', 'Robotique'],
    facebook: '',
    email: 'esprit-club-fusion@esprit.tn',
  },
  {
    name: 'ESPRIT Club Conceptronix',
    category: 'Conception mecanique',
    description:
      'Club cree en 2016 pour participer aux competitions nationales de CAO et partager la passion de la conception mecanique.',
    objectives: [
      'Participer aux competitions CAO',
      'Transmettre les connaissances',
      'Realiser des projets innovants',
    ],
    activities: [
      'SolidWorks Day',
      'National Design Competition',
      'Projets de conception',
    ],
    facebook: '',
    email: 'esprit-club-conceptronix@esprit.tn',
  },
  {
    name: 'ESPRIT You ROBOT',
    category: 'Robotique / Electronique / Programmation',
    description:
      'Fonde en 2009 par des etudiants passionnes de robotique, d electronique et de programmation.',
    objectives: [
      "Developper l'esprit d'equipe et les competences techniques",
    ],
    activities: ['Formations', 'Projets robotiques', 'Activites techniques'],
    facebook: '',
    email: 'esprit-club-yourobot@esprit.tn',
  },
  {
    name: 'ESPRIT CISCO',
    category: 'Reseaux / Certifications',
    description:
      'Club destine aux etudiants d ESPRIT, surtout en TIC, pour la formation aux reseaux et certifications.',
    objectives: [
      'Former aux certifications',
      'Promouvoir les nouvelles technologies reseaux',
      'Organiser des competitions et evenements reseaux',
    ],
    activities: [
      'Coaching certification',
      'Forums de discussion',
      'NetRiders',
      'Evenements reseaux',
    ],
    facebook: '',
    email: 'esprit-club-fusion@esprit.tn',
  },
  {
    name: 'ESPRIT Club IeeeSb',
    category: 'Technologie / Innovation',
    description:
      'IEEE est une grande organisation professionnelle technique dediee a l avancement de la technologie au profit de l humanite.',
    objectives: ['Promouvoir la technologie et l innovation'],
    activities: ['Evenements techniques', 'Conferences', 'Workshops'],
    facebook: '',
    email: 'esprit-club-ieeesb@esprit.tn',
  },
  {
    name: 'Club Genie Civil Esprit',
    category: 'Genie civil',
    description:
      'Club cree pour ameliorer la formation des etudiants ingenieurs en Genie Civil.',
    objectives: [
      'Renforcer la formation pratique des etudiants en genie civil',
    ],
    activities: ['Visites de chantiers', 'Formations', 'Conferences'],
    facebook: '',
    email: '',
  },
  {
    name: 'ESPRIT Club Internationaux',
    category: 'International / Culture',
    description:
      'Club visant a faciliter l integration des etudiants internationaux en Tunisie et a ESPRIT.',
    objectives: [
      'Faciliter l integration',
      'Promouvoir la diversite culturelle',
    ],
    activities: ['Activites culturelles', 'Evenements d integration'],
    facebook: '',
    email: 'esprit-club-internationaux@esprit.tn',
  },
  {
    name: 'EMUN',
    category: 'Diplomatie / Relations internationales',
    description:
      'Club simulant les travaux des Nations Unies pour former les participants aux negociations internationales.',
    objectives: [
      'Promouvoir les droits de l homme',
      'Developper la communication et la diplomatie',
    ],
    activities: ['Simulations ONU', 'Debats', 'Negociations internationales'],
    facebook: '',
    email: 'emun@esprit.tn',
  },
  {
    name: 'ESPRIT Club engineers Spark',
    category: 'Innovation / Developpement web / Systemes embarques',
    description:
      'Club qui encourage l innovation et la creativite a travers des programmes riches et varies.',
    objectives: [
      'Developper la creativite',
      'Former les etudiants aux technologies modernes',
    ],
    activities: [
      'Formations web',
      'HTML',
      'CSS',
      'PHP',
      'JavaScript',
      'MEAN Stack',
      'JEE',
      '.NET',
      'Systemes embarques',
      'Robotique',
    ],
    facebook: '',
    email: 'esprit-club-engineersspark@esprit.tn',
  },
  {
    name: 'Esprit ENACTUS',
    category: 'Entrepreneuriat social',
    description:
      'Fonde en fevrier 2014, ce club travaille sur des projets d entrepreneuriat social et participe aux competitions ENACTUS.',
    objectives: [
      'Developper l entrepreneuriat social',
      'Participer aux competitions nationales et internationales',
    ],
    activities: ['Projets sociaux', 'Competitions ENACTUS'],
    facebook: '',
    email: 'esprit-club-enactus-charguia@esprit.tn',
  },
  {
    name: 'ESPRIT Junior Entreprise TIC',
    category: 'Junior Entreprise / TIC',
    description:
      'Junior Entreprise orientee TIC permettant aux etudiants de realiser des projets professionnels.',
    objectives: ['Relier l universite au monde professionnel'],
    activities: ['Projets TIC', 'Missions professionnelles'],
    facebook: '',
    email: 'junior-entreprisetic@esprit.tn',
  },
  {
    name: 'Auto Club Esprit',
    category: 'Automobile',
    description:
      'Cree durant l annee universitaire 2013-2014, le club encourage l initiative et la creativite dans le domaine automobile.',
    objectives: ['Soutenir la passion automobile des etudiants'],
    activities: ['Activites automobiles', 'Projets techniques'],
    facebook: '',
    email: 'esprit-club-auto@esprit.tn',
  },
  {
    name: 'ESPRIT Club Libre',
    category: 'Logiciels libres / Open Source',
    description:
      'Fonde le 27 octobre 2007, le club reunit les etudiants interesses par la philosophie du libre.',
    objectives: [
      'Promouvoir les logiciels libres',
      'Developper la recherche et le travail en groupe',
    ],
    activities: [
      'Conferences',
      'Ateliers',
      'Aide technique',
      'Sensibilisation au libre',
    ],
    facebook: '',
    email: 'esprit-club-enactus-charguia@esprit.tn',
  },
  {
    name: 'Enactus Esprit ICT',
    category: 'Entrepreneuriat social',
    description:
      'Fondee en 2013, Enactus Esprit ICT accompagne les etudiants dans la realisation de projets pour ameliorer la qualite de vie des communautes.',
    objectives: [
      'Developper la responsabilite et les competences entrepreneuriales des etudiants',
    ],
    activities: ['Projets communautaires', 'Entrepreneuriat social'],
    facebook: '',
    email: '',
  },
  {
    name: 'ESPRO Junior Entreprise',
    category: 'Junior Entreprise',
    description:
      'Junior Entreprise faisant le lien entre l universite et le monde professionnel, permettant aux etudiants de travailler sur des projets reels.',
    objectives: [
      'Permettre aux etudiants d appliquer leurs connaissances theoriques dans des projets professionnels',
    ],
    activities: [
      'Projets clients',
      'Missions professionnelles',
      'Developpement de competences',
    ],
    facebook: '',
    email: '',
  },
];
