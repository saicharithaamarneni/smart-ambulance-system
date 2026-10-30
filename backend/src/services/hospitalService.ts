import { Hospital, IHospital } from '../models/Hospital';
import { calculateDistance, calculateETA } from '../utils/geoUtils';
import { logger } from '../utils/logger';

export interface HospitalRecommendation {
  hospital: IHospital;
  distanceKm: number;
  etaMinutes: number;
  suitabilityScore: number;
  reasons: string[];
  warnings: string[];
  rank: number;
}

const SPECIALTY_MAP: Record<string, string[]> = {
  cardiac_arrest: ['Cardiology', 'Emergency Medicine', 'ICU'],
  stroke: ['Neurology', 'Emergency Medicine', 'ICU'],
  trauma: ['Trauma Surgery', 'Emergency Medicine', 'Orthopedics'],
  respiratory: ['Pulmonology', 'Emergency Medicine', 'ICU'],
  obstetric: ['Obstetrics', 'Gynecology', 'NICU'],
  pediatric: ['Pediatrics', 'NICU', 'Emergency Medicine'],
  burns: ['Plastic Surgery', 'Burn Center', 'ICU'],
  poisoning: ['Toxicology', 'Emergency Medicine', 'ICU'],
  diabetic: ['Endocrinology', 'Emergency Medicine'],
  psychiatric: ['Psychiatry', 'Emergency Medicine'],
  other: ['Emergency Medicine'],
};

const FACILITY_MAP: Record<string, string[]> = {
  cardiac_arrest: ['Cath Lab', 'Cardiac ICU', 'Defibrillator'],
  stroke: ['CT Scanner', 'MRI', 'Neurology ICU'],
  trauma: ['Operation Theatre', 'Blood Bank', 'Trauma Bay'],
  respiratory: ['Ventilators', 'ICU', 'Oxygen Supply'],
  obstetric: ['Labour Room', 'NICU', 'Operation Theatre'],
  pediatric: ['NICU', 'Pediatric ICU'],
  burns: ['Burn Unit', 'ICU', 'Skin Bank'],
  poisoning: ['Dialysis Unit', 'ICU'],
  diabetic: ['ICU'],
  psychiatric: ['Psychiatric Ward'],
  other: ['Emergency Department'],
};

/**
 * Recommend hospitals based on patient location, emergency type, and hospital capacity.
 * Returns sorted array with suitability scores and explainable reasons.
 */
export async function recommendHospitals(
  patientLat: number,
  patientLng: number,
  emergencyCategory: string,
  limit: number = 5
): Promise<HospitalRecommendation[]> {
  const hospitals = await Hospital.find({ isActive: true });

  if (hospitals.length === 0) {
    logger.warn('No active hospitals found in database');
    return [];
  }

  const requiredSpecialties = SPECIALTY_MAP[emergencyCategory] || SPECIALTY_MAP['other'];
  const requiredFacilities = FACILITY_MAP[emergencyCategory] || FACILITY_MAP['other'];
  const STALE_CAPACITY_THRESHOLD_MINUTES = 30;

  const recommendations: HospitalRecommendation[] = hospitals.map((hospital) => {
    let score = 100;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // Distance calculation
    const distanceKm = calculateDistance(
      patientLat,
      patientLng,
      hospital.location.lat,
      hospital.location.lng
    );
    const etaMinutes = calculateETA(distanceKm, 'ALS');

    // Distance penalty: -4 pts per km
    const distancePenalty = Math.min(distanceKm * 4, 60);
    score -= distancePenalty;
    reasons.push(`Distance: ${distanceKm.toFixed(1)} km, ETA: ${etaMinutes} min`);

    // Emergency department availability
    if (!hospital.emergencyDepartment.isAvailable) {
      score -= 50;
      warnings.push('Emergency department NOT available');
    } else {
      const edUtilization =
        hospital.emergencyDepartment.currentOccupancy /
        Math.max(hospital.emergencyDepartment.capacity, 1);
      if (edUtilization >= 1) {
        score -= 40;
        warnings.push('Emergency department at FULL capacity');
      } else if (edUtilization >= 0.8) {
        score -= 15;
        warnings.push(`Emergency department ${Math.round(edUtilization * 100)}% full`);
      } else {
        score += 10;
        reasons.push(`ED available (${Math.round(edUtilization * 100)}% occupied)`);
      }
    }

    // ICU availability
    if (hospital.icuBeds.available > 0) {
      score += 15;
      reasons.push(`${hospital.icuBeds.available} ICU beds available`);
    } else {
      score -= 20;
      warnings.push('No ICU beds available');
    }

    // General bed availability
    if (hospital.generalBeds.available > 10) {
      score += 10;
      reasons.push(`${hospital.generalBeds.available} general beds available`);
    } else if (hospital.generalBeds.available <= 0) {
      score -= 15;
      warnings.push('No general beds available');
    }

    // Specialty match
    const matchedSpecialties = requiredSpecialties.filter((s) =>
      hospital.specialties.some((hs) => hs.toLowerCase().includes(s.toLowerCase()))
    );
    if (matchedSpecialties.length > 0) {
      const specialtyBonus = matchedSpecialties.length * 8;
      score += specialtyBonus;
      reasons.push(`Specialty match: ${matchedSpecialties.join(', ')} (+${specialtyBonus} pts)`);
    } else {
      score -= 10;
      warnings.push(`No specialty match for ${emergencyCategory}`);
    }

    // Facility match
    const matchedFacilities = requiredFacilities.filter((f) =>
      hospital.facilities.some((hf) => hf.toLowerCase().includes(f.toLowerCase()))
    );
    if (matchedFacilities.length > 0) {
      const facilityBonus = matchedFacilities.length * 5;
      score += facilityBonus;
      reasons.push(`Facilities available: ${matchedFacilities.join(', ')}`);
    }

    // Data freshness
    const capacityAge = Date.now() - hospital.capacityLastUpdated.getTime();
    const capacityAgeMinutes = capacityAge / 60000;
    if (capacityAgeMinutes > STALE_CAPACITY_THRESHOLD_MINUTES) {
      score -= 10;
      warnings.push(`Capacity data is ${Math.round(capacityAgeMinutes)} min old — may not be current`);
    }

    // Demo data warning
    if (hospital.isDemo) {
      warnings.push('⚠️ DEMO DATA — not confirmed real-time availability');
    }

    return {
      hospital,
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      etaMinutes,
      suitabilityScore: parseFloat(Math.max(0, score).toFixed(2)),
      reasons,
      warnings,
      rank: 0,
    };
  });

  // Sort by suitability score (descending)
  recommendations.sort((a, b) => b.suitabilityScore - a.suitabilityScore);

  // Assign ranks
  recommendations.forEach((rec, index) => {
    rec.rank = index + 1;
  });

  return recommendations.slice(0, limit);
}
