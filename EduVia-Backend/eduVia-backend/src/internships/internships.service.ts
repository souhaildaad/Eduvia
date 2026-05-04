import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Internship, InternshipDocument } from './internship.schema';

type InternshipInput = Partial<Internship> & { skills?: string[] | string };

@Injectable()
export class InternshipsService {
  constructor(
    @InjectModel(Internship.name)
    private readonly internshipModel: Model<InternshipDocument>,
  ) {}

  async findAll() {
    await this.ensureSeedData();
    const internships = await this.internshipModel.find().sort({ createdAt: -1 }).lean().exec();
    await this.ensureStoredCoordinates(internships);
    return internships;
  }

  async create(input: InternshipInput) {
    const normalized = this.normalizeInput(input);
    this.validateInput(normalized);
    await this.attachGeocodedCoordinates(normalized);
    const internship = new this.internshipModel(normalized);
    return internship.save();
  }

  async update(id: string, input: InternshipInput) {
    const normalized = this.normalizeInput(input);
    this.validateInput(normalized);
    await this.attachGeocodedCoordinates(normalized);
    const internship = await this.internshipModel
      .findByIdAndUpdate(id, normalized, { new: true })
      .exec();

    if (!internship) {
      throw new BadRequestException('Stage introuvable.');
    }

    return internship;
  }

  async delete(id: string) {
    await this.internshipModel.findByIdAndDelete(id).exec();
    return { success: true };
  }

  private normalizeInput(input: InternshipInput) {
    const skills = Array.isArray(input.skills)
      ? input.skills
      : String(input.skills || '')
          .split(/\n|,/)
          .map(skill => skill.trim())
          .filter(Boolean);

    return {
      title: String(input.title || '').trim(),
      company: String(input.company || '').trim(),
      city: String(input.city || '').trim(),
      domain: String(input.domain || '').trim(),
      duration: String(input.duration || '').trim(),
      level: String(input.level || 'L2').trim(),
      email: String(input.email || '').trim().toLowerCase(),
      phone: String(input.phone || '').trim(),
      website: String(input.website || '').trim(),
      deadline: String(input.deadline || '').trim(),
      description: String(input.description || '').trim(),
      skills,
      address: String(input.address || '').trim(),
      latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : null,
      longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : null,
    };
  }

  private async attachGeocodedCoordinates(input: ReturnType<InternshipsService['normalizeInput']>) {
    if (this.hasUsableTunisiaCoordinates(input.latitude, input.longitude)) {
      return;
    }

    const coordinates = await this.geocodeAddress(input);
    if (!coordinates) {
      return;
    }

    input.latitude = coordinates.latitude;
    input.longitude = coordinates.longitude;
  }

  private async ensureStoredCoordinates(internships: Array<Internship & { _id?: unknown }>) {
    await Promise.all(
      internships.map(async internship => {
        if (this.hasUsableTunisiaCoordinates(internship.latitude, internship.longitude)) {
          return;
        }

        const normalized = this.normalizeInput(internship);
        await this.attachGeocodedCoordinates(normalized);

        if (!Number.isFinite(Number(normalized.latitude)) || !Number.isFinite(Number(normalized.longitude))) {
          return;
        }

        internship.latitude = normalized.latitude;
        internship.longitude = normalized.longitude;

        await this.internshipModel
          .findByIdAndUpdate(internship._id, {
            latitude: normalized.latitude,
            longitude: normalized.longitude,
          })
          .exec();
      }),
    );
  }

  private hasUsableTunisiaCoordinates(latitude: unknown, longitude: unknown) {
    const lat = Number(latitude);
    const lng = Number(longitude);

    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= 30 &&
      lat <= 38.8 &&
      lng >= 7 &&
      lng <= 12.2
    );
  }

  private async geocodeAddress(input: ReturnType<InternshipsService['normalizeInput']>) {
    const knownLocation = this.knownTunisiaLocation(input);
    if (knownLocation) {
      return knownLocation;
    }

    const address = [input.address, input.city, 'Tunisia'].filter(Boolean).join(', ');
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'tn');

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': process.env.OPENSTREETMAP_USER_AGENT || 'EduVia/1.0',
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        return null;
      }

      const data = await response.json() as Array<{ lat?: string; lon?: string }>;
      const location = Array.isArray(data) ? data[0] : null;
      const latitude = Number(location?.lat);
      const longitude = Number(location?.lon);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        latitude,
        longitude,
      };
    } catch {
      return null;
    }
  }

  private knownTunisiaLocation(input: ReturnType<InternshipsService['normalizeInput']>) {
    const haystack = [
      input.address,
      input.city,
      input.company,
    ]
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const isElGhazala =
      haystack.includes('pole technologique') ||
      haystack.includes('technopole') ||
      haystack.includes('ghazala') ||
      haystack.includes('ghazela') ||
      haystack.includes('esprit') ||
      haystack.includes('andre ampere');

    if (!isElGhazala || !haystack.includes('ariana')) {
      return null;
    }

    return {
      latitude: 36.89315,
      longitude: 10.18785,
    };
  }

  private validateInput(input: ReturnType<InternshipsService['normalizeInput']>) {
    const requiredFields: Array<keyof typeof input> = [
      'title',
      'company',
      'city',
      'domain',
      'duration',
      'level',
      'email',
      'phone',
      'deadline',
      'description',
      'address',
    ];
    const missingField = requiredFields.find(field => !String(input[field] || '').trim());
    if (missingField) {
      throw new BadRequestException(`Champ obligatoire manquant: ${String(missingField)}.`);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw new BadRequestException('Email invalide.');
    }
    if (!/^[+0-9 ()-]{8,20}$/.test(input.phone)) {
      throw new BadRequestException('Telephone invalide.');
    }
    if (!/^[0-9]+\s*(mois|semaines|jours)$/i.test(input.duration)) {
      throw new BadRequestException('Duree invalide. Exemple: 3 mois.');
    }
    if (input.website && !/^https?:\/\/.+/i.test(input.website)) {
      throw new BadRequestException('Site web invalide.');
    }
    if (!input.skills.length) {
      throw new BadRequestException('Ajoutez au moins une competence.');
    }
    if (input.description.length < 20) {
      throw new BadRequestException('La description doit contenir au moins 20 caracteres.');
    }
  }

  private async ensureSeedData() {
    const count = await this.internshipModel.countDocuments().exec();
    if (count > 0) {
      return;
    }

    await this.internshipModel.insertMany([
      {
        title: 'Developpeur Web Full-Stack',
        company: 'TechCorp Solutions',
        city: 'Paris',
        domain: 'Developpement Web',
        duration: '3 mois',
        level: 'L2',
        email: 'recrutement@techcorp.fr',
        phone: '+33 1 23 45 67 89',
        website: 'https://www.techcorp.fr',
        deadline: '2026-06-15',
        description:
          'Stage pratique autour du developpement frontend et backend, avec participation a des fonctionnalites web completes.',
        skills: ['Angular ou React', 'Node.js', 'Bases REST API', 'Git'],
        address: '12 Avenue de France, 75013 Paris',
        latitude: 48.8298,
        longitude: 2.3761,
      },
      {
        title: 'Analyste Donnees & Machine Learning',
        company: 'DataVision Analytics',
        city: 'Lyon',
        domain: 'Data Science',
        duration: '4 mois',
        level: 'L3',
        email: 'recrutement@datavision.fr',
        phone: '+33 4 72 77 40 00',
        website: 'https://www.datavision.fr',
        deadline: '2026-05-25',
        description:
          "Stage passionnant au sein de notre equipe Data Science. Tu participeras a l'analyse de grands volumes de donnees et au developpement de modeles de machine learning pour nos clients.",
        skills: ['Python et bibliotheques data', 'Bases en statistiques', 'Curiosite pour le ML', "Capacite d'analyse"],
        address: '15 Rue de la Republique, 69002 Lyon',
        latitude: 45.764,
        longitude: 4.8357,
      },
      {
        title: 'Administrateur Systemes & Reseaux',
        company: 'SecureNet Infrastructure',
        city: 'Clichy',
        domain: 'Reseaux',
        duration: '6 mois',
        level: 'L2',
        email: 'contact@securenet.fr',
        phone: '+33 1 48 00 12 30',
        website: 'https://www.securenet.fr',
        deadline: '2026-07-01',
        description:
          "Stage oriente administration systeme, supervision reseau et securisation d'environnements internes.",
        skills: ['Linux', 'Reseaux TCP/IP', 'Supervision', 'Rigueur'],
        address: '20 Rue Villeneuve, 92110 Clichy',
        latitude: 48.9045,
        longitude: 2.3064,
      },
    ]);
  }
}
