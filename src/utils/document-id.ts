// Nota: evitamos importar el tipo Strapi ya que no se exporta directamente en v5.

// Helper para trabajar SIEMPRE con documentId
export async function getEntryByDocumentId(strapi: any, uid: string, documentId: string, options: any = {}) {
  return await (strapi.db as any).query(uid).findOne({ where: { documentId }, ...options });
}

export async function deleteEntryByDocumentId(strapi: any, uid: string, documentId: string) {
  return await (strapi.db as any).query(uid).delete({ where: { documentId } });
}

export async function updateEntryByDocumentId(strapi: any, uid: string, documentId: string, data: any) {
  return await (strapi.db as any).query(uid).update({ where: { documentId }, data });
}

export async function existsByDocumentId(strapi: any, uid: string, documentId: string) {
  const found = await (strapi.db as any).query(uid).findOne({ where: { documentId }, select: ['documentId'] });
  return !!found;
}