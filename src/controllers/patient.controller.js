import axios from 'axios';
import response from '../utils/response.js';

export const searchPatients = async (req, res) => {
  try {
    const { q, query, search } = req.query;
    const queryStr = (q || query || search || '').trim();

    if (!queryStr) {
      return response.success(res, 'Patients retrieved', []);
    }

    const solrUrl = process.env.HIMS_PATIENT_SEARCH_URL;
    if (!solrUrl) {
      return response.serverError(res, 'Patient search is not configured');
    }
    let solrQuery = queryStr;
    if (!solrQuery.includes('*')) {
      solrQuery = `*${solrQuery}*`;
    }

    const solrRes = await axios.get(solrUrl, {
      params: {
        wt: 'json',
        rows: 25,
        q: solrQuery,
      },
      timeout: 5000,
    });

    const docs = solrRes.data?.response?.docs || [];

    const patients = docs.map((doc) => {
      const mrno = String(doc.mrno || doc.mr_no || doc.MRNO || doc.uhid || '').trim();
      const patientname = String(doc.patientname || doc.patient_name || doc.name || '').trim();
      const mobilenumber = String(doc.mobilenumber || doc.mobile_no || doc.mobile || doc.phone || '').trim();
      const gender = String(doc.gender || doc.gender_name || doc.sex || '').trim();
      const age = doc.age || doc.AGE || doc.patientage || '';
      const prefix = doc.prefix || '';

      return {
        mrno,
        patientname: prefix ? `${prefix} ${patientname}` : patientname,
        mobilenumber,
        gender,
        age,
        display_label: `${mrno} - ${patientname} ${mobilenumber ? `(${mobilenumber})` : ''}`,
      };
    }).filter((p) => p.mrno || p.patientname);

    return response.success(res, 'Patients retrieved successfully', patients);
  } catch (err) {
    console.error('[HIMS Solr Patient Search Error]:', err.message);
    return response.serverError(res, 'Failed to search patients from HIMS', err.message);
  }
};
