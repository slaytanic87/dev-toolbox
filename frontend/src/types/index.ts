
export interface RestRequest {
    method: string;
    path: string;
    headers?: Array<[string, string]>;
    body?: string;
}

export interface RestResponse {
    status: number;
    headers?: Array<[string, string]>;
    body?: string;
}