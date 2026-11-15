// --- User Access Configuration (server-side source of truth) ---
// Moved from src/utils.js so passwords never ship in the client bundle.
// Roles here are what Firestore rules and callable functions trust.
// Valid roles: master, employee, qmt.

const GOOGLE_ACCOUNTS = {
  "iftekher.ifty@gmail.com": "master",
  "adeebkhan51@gmail.com": "master",
  "shahmd.nadim@gmail.com": "master",
  "mominrhaman007@gmail.com": "master",
  "mominbackstory@gmail.com": "employee",
  "iqramulhaque2404@gmail.com": "employee",
};

const CREDENTIAL_ACCOUNTS = {
  "bentree": {pass: "bentree12321", role: "master", name: "Bentree Master"},
  "bentreeteam1": {
    pass: "bentree321", role: "employee", name: "Internal Member 01",
  },
  "bentreeteam2": {
    pass: "bentree112", role: "employee", name: "Internal Member 02",
  },
  "bentreeteam3": {
    pass: "bentree123", role: "employee", name: "Internal Member 03",
  },
  "user1": {pass: "bnt", role: "qmt", name: "Team Member 01"},
  "user2": {pass: "bentree11223", role: "qmt", name: "Team Member 02"},
  "user3": {pass: "bnt", role: "qmt", name: "Team Member 03"},
  "user4": {pass: "bentree12354", role: "qmt", name: "Team Member 04"},
  "user5": {pass: "bnt", role: "qmt", name: "Team Member 05"},
  "user6": {pass: "bnt", role: "qmt", name: "Team Member 06"},
  "user7": {pass: "bnt", role: "qmt", name: "Team Member 07"},
  "user8": {pass: "bnt", role: "qmt", name: "Team Member 08"},
  "user9": {pass: "bnt", role: "qmt", name: "Team Member 09"},
  "user10": {pass: "bnt", role: "qmt", name: "Team Member 10"},
  "user11": {pass: "bentree11", role: "qmt", name: "Team Member 11"},
  "user12": {pass: "bnt", role: "qmt", name: "Team Member 12"},
  "user13": {pass: "bnt", role: "qmt", name: "Team Member 13"},
  "user14": {pass: "bnt", role: "qmt", name: "Team Member 14"},
  "user15": {pass: "bnt", role: "qmt", name: "Team Member 15"},
};

module.exports = {GOOGLE_ACCOUNTS, CREDENTIAL_ACCOUNTS};
