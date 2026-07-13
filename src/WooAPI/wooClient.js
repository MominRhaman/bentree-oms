import axios from 'axios';

export const WOO_BASE = 'https://www.bentreebd.com/wp-json/wc/v3';

export const wooApi = axios.create({
    baseURL: WOO_BASE,
    auth: {
        username: 'ck_a7c1c5b6f012681cdcfe6c4abb15e9806efa0a1c',
        password: 'cs_4920499d93f53ca3197d7e98dd06e14459c8cb31',
    },
});
