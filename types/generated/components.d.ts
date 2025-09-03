import type { Schema, Struct } from '@strapi/strapi';

export interface SharedEmployeeContractTerms extends Struct.ComponentSchema {
  collectionName: 'components_shared_employee_contract_terms';
  info: {
    displayName: 'Employee contract terms';
  };
  attributes: {
    contractDuration: Schema.Attribute.Enumeration<
      [
        'permanent',
        'temporary',
        'fixedterm',
        'parttime',
        'fulltime',
        'seasonal',
        'internship',
      ]
    >;
    description: Schema.Attribute.Text;
    end: Schema.Attribute.Date;
    hourlyRate: Schema.Attribute.Decimal;
    paymentPeriod: Schema.Attribute.Enumeration<
      ['daily', 'weekly', 'biweekly', 'monthly', 'annual']
    >;
    start: Schema.Attribute.Date;
    title: Schema.Attribute.String;
    workedHours: Schema.Attribute.Decimal;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    file: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
  };
}

export interface SharedPeriod extends Struct.ComponentSchema {
  collectionName: 'components_shared_periods';
  info: {
    displayName: 'Period';
  };
  attributes: {
    end: Schema.Attribute.Date;
    start: Schema.Attribute.Date;
    year: Schema.Attribute.String;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    body: Schema.Attribute.RichText;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaTitle: Schema.Attribute.String & Schema.Attribute.Required;
    shareImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    files: Schema.Attribute.Media<'images', true>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.employee-contract-terms': SharedEmployeeContractTerms;
      'shared.media': SharedMedia;
      'shared.period': SharedPeriod;
      'shared.quote': SharedQuote;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slider': SharedSlider;
    }
  }
}
