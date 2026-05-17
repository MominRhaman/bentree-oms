import axios from 'axios';

export const WOO_BASE = 'https://bentreebd.com/wp-json/wc/v3';

export const wooApi = axios.create({
    baseURL: WOO_BASE,
    auth: {
        username: 'ck_651b90a834145227aba5a90b36bd12a29bb41bc9',
        password: 'cs_dde1553303d86acfdd56564e7be16c5cc496bd85',
    },
});
